import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import type { Environment } from '../config/environment.js';
import { TokenService } from '../token/token.service.js';
import type { TokenPurpose } from '../token/token.types.js';
import { UNUSABLE_TOKEN_MESSAGE } from '../token/unusable-token-message.js';
import { ipSubnetKey, normalizeIpAddress } from './ip-address.js';
import { recordActivity } from './last-activity.js';
import { delayForFailures, isBlocked } from './throttle.js';
import { uuidv7 } from './uuidv7.js';
import { CaptchaRequiredException } from './captcha-required.exception.js';
import { CaptchaService } from './captcha.service.js';
import type { EmailVerificationConfirmDto } from './email-verification-confirm.dto.js';
import type { EmailVerificationConfirmedDto } from './email-verification-confirmed.dto.js';
import type { LoginRequestDto } from './login-request.dto.js';
import type { LoginResponseDto } from './login-response.dto.js';
import type { LogoutRequestDto } from './logout-request.dto.js';
import type { PasswordResetConfirmDto } from './password-reset-confirm.dto.js';
import type { PasswordResetConfirmedDto } from './password-reset-confirmed.dto.js';
import type { RefreshRequestDto } from './refresh-request.dto.js';
import type { RefreshResponseDto } from './refresh-response.dto.js';
import type { TokenRequestAcceptedDto } from './token-request-accepted.dto.js';
import type { TokenRequestDto } from './token-request.dto.js';

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string;
  /**
   * Whether this account is currently switched off, decided by the DATABASE in the
   * `SELECT` that read the row rather than by the application after reading it. See
   * `DISABLED_ACCOUNT_PREDICATE_SQL`.
   */
  readonly is_disabled: boolean;
}

/**
 * bcrypt cost. `AGENTS.md` §B6 asks for "cost ≥ 12, configurable"; 12 is the
 * floor that text names and the same cost `bcrypt.hashSync` below uses, so the canary
 * and every real hash cost exactly what each other does — which is the entire point
 * of the canary. It is a named constant rather than a literal repeated in three
 * places because a cost that drifts between them is a timing oracle that only
 * exists on the login path.
 *
 * It is NOT configurable, and that is a recorded gap rather than a decision: making
 * it a config key means a forker can set `4` and turn every hash in the tree into a
 * fast one, which is §2.3's "a default nobody chose silently applies" with the
 * sign flipped. The honest fix is a lower bound enforced at boot, which is a change
 * to `environment.ts` and out of scope here.
 */
export const BCRYPT_COST = 12;

/**
 * Constant dummy password hash at the same bcrypt cost the seed uses, so an
 * unknown username burns exactly the same compare cost as a wrong password for
 * a real account. Without this, a missed login is measurably faster than a
 * wrong-password login and leaks which accounts exist (§2.3). Verified false
 * against every input, so the branch below treats it as a non-match.
 */
const UNKNOWN_USER_PASSWORD_HASH = bcrypt.hashSync('username-oracle-canary', BCRYPT_COST);

/**
 * Which counter a `login_attempts` row belongs to — the discriminator `0019`
 * added so a reset-request flood cannot spend a login's delay budget and vice
 * versa.
 *
 * The two request routes share one kind because they are the same act aimed at the
 * same mailbox; see `0019_login_attempt_kind.sql` for why one budget for both is
 * the stronger control rather than the lazier one.
 */
export type AttemptKind = 'login' | 'token_request';

/**
 * The single message every failed redemption gets now lives in
 * `src/token/unusable-token-message.ts`, beside the primitive, because there are three
 * redemption routes and the property that makes them safe is that all three spend the
 * SAME string on all four failure modes. See that file for the full argument.
 *
 * **One string, four failures.** Expired, already-redeemed, presented for the wrong
 * purpose, and never issued at all all reach the same `400` with
 * `UNUSABLE_TOKEN_MESSAGE`, because `TokenService.redeem` returns one
 * `invalid_or_expired` for all four and anything that branched on which one it was
 * would hand back the distinction the primitive spent its single-use design to remove.
 * A caller who learns *which* reason their link failed has learned whether the link
 * ever existed.
 *
 * It also says nothing about the account: a valid token does not get a friendlier
 * message either, because "that link worked" is itself the answer an attacker is
 * after and they already have it.
 */

/** A redemption that carries no user cannot reset anything, and saying so is this application's bug. */
function unusableTokenWithoutSubject(purpose: TokenPurpose): Error {
  return new Error(
    `a ${purpose} token was redeemed with no subject: the request path always mints with a user id, ` +
      'so this is not reachable from an HTTP request and must not be treated as a bad link',
  );
}

/**
 * THE ONE CREDENTIAL REFUSAL, AND WHY IT IS A CONSTANT RATHER THAN A LITERAL IN
 * FOUR PLACES.
 *
 * Four answers reach the caller as this exact `401` with this exact body: an
 * unknown username, a wrong password, an account an operator has **disabled**, and
 * a request the gate blocked before it ever reached bcrypt. Three of the four are
 * decided by a single condition in `issueSession` and the fourth by a single `throw`
 * in `login`, so the property that makes this route safe — that a prober cannot tell
 * them apart — would otherwise rest entirely on two authors typing the same two words
 * identically. A constant makes it a fact about the module instead of a coincidence
 * between two lines, which is the difference between reading it once and reviewing it
 * forever.
 *
 * ## WHY A DISABLED ACCOUNT IS IN THIS LIST AND NOT SOMEWHERE ELSE
 *
 * "Your account has been disabled" is the single most useful thing an attacker can
 * be handed on this route, and it is worth being precise about the three reasons,
 * because only the first is obvious:
 *
 *   * **It confirms the account exists.** The whole enumeration defence is that a
 *     wrong password and a missing account answer identically — see `login()`'s own
 *     docstring, which the disabled case would become the single exception to. One
 *     exception to an anti-enumeration property is the enumeration.
 *   * **It says the account is a TARGET, not merely that it exists.** A disable is
 *     recorded for a reason, and `0023` closes that vocabulary at four values
 *     (`admin`, `security`, `compliance`, `user_request`). "This account is
 *     disabled" therefore narrows the population from every account in the
 *     installation to the accounts somebody has *already acted on* — the residue of
 *     a compromise, a compliance case, a leaver. That is a shortlist, not an
 *     existence bit, and the whole value of the column to an attacker is that it
 *     hands them one.
 *   * **It is a DIFFERENT FAILURE from a wrong password, and so it changes what the
 *     caller does.** A caller told the credentials are wrong gives up on that
 *     account. A caller told the account is disabled retries through another route,
 *     complains to support, or comes back tomorrow with the same password. The
 *     account holder is the one caller for whom the message would be genuinely
 *     useful — and the account holder is not who an attacker is.
 *
 * §B6's rule that behavioural and risk scoring is *triage* rather than prevention
 * is the same thought from the other direction: the decision is made, the detail
 * belongs to whoever is already inside, and it belongs on the row — `disabled_reason`,
 * `disabled_by`, `disabled_until` — where the account holder and an investigator
 * can both read it. It does not belong on the login response.
 *
 * `0023`'s own header is the other half of the argument, and it is the reason this
 * was a defect rather than a feature nobody had asked for yet: that migration adds
 * four columns that record a decision **and enforce nothing**, and names the login
 * path as the enforcement half. Until the check existed, `disabled_at` was a
 * record that read exactly like a control, which is §2.1's most expensive shape.
 */
const INVALID_CREDENTIALS_MESSAGE = 'invalid credentials';

/**
 * WHAT COUNTS AS DISABLED — the whole rule, in one SQL expression — and why each
 * clause of it is load-bearing.
 *
 *     disabled_at IS NOT NULL AND (disabled_until IS NULL OR disabled_until > now())
 *
 * Four rows and the last one is the case a naive check gets wrong:
 *
 *   * `disabled_at IS NULL` — never disabled. The overwhelming majority, forever.
 *   * `disabled_at` set, `disabled_until` NULL — disabled until somebody lifts it.
 *     NULL here is a real answer ("not temporary"), not "unknown", on exactly the
 *     rule `0009:192-212` establishes for the `deleted_at` pair.
 *   * `disabled_at` set, `disabled_until` in the future — a SUSPENSION: still off.
 *   * `disabled_at` set, `disabled_until` in the past — **the suspension is OVER**
 *     and the account may sign in again without an administrator noticing.
 *
 * Writing `WHERE disabled_at IS NOT NULL` throws the last case away and produces
 * the support incident the column was added to prevent: an account suspended for an
 * hour stays suspended until a human lifts it. `disabled_until` exists for exactly
 * that account, so a predicate that ignores it is not a simpler policy — it is a
 * *different* policy from the one the schema expresses, and it is the one a reader
 * of the migration would assume the code implements.
 *
 * ## WHY `now()` AND NOT A TIMESTAMP THIS PROCESS SUPPLIED
 *
 * This is §B2's position about a caller-supplied value a policy reads, applied to a
 * caller-supplied value the account-state decision reads. The application clock and
 * the database clock are two clocks, and a comparison against the wrong one is wrong
 * by exactly the skew between them: at a `disabled_until` a few milliseconds away
 * the two disagree about whether this account may sign in, and whichever half is
 * wrong refuses a legitimate credential check for the size of the skew. Reading the
 * timestamp into a `Date` and testing it here would also mean the decision is made
 * by a process whose clock nobody in this schema has an opinion about.
 *
 * `now()` is additionally the **transaction** timestamp, which is a second, quieter
 * win: the predicate, the `UPDATE login_attempts` that records the refusal, and the
 * `last_login_at` write on the success branch are then all stamped by one clock
 * reading, so the audit rows cannot disagree with each other about when the request
 * happened.
 *
 * ## WHY IT IS A CONSTANT AND NOT A STRING INSIDE TWO `SELECT`s
 *
 * `findUser` (sign-in) and `findUserById` (refresh) both need it, and §2.4's rule
 * about duplicated mechanisms is exact here: a predicate that exists in two copies
 * is a predicate that exists in one correct copy and one drifted copy, and the
 * drifted one is the one nobody re-reads. Exporting it also makes it *assertable* —
 * the fact that this check runs against the database's clock is carried by the word
 * `now()` in the shipped text, and text is the one thing a test can read without a
 * database.
 */
export const DISABLED_ACCOUNT_PREDICATE_SQL = '(disabled_at IS NOT NULL AND (disabled_until IS NULL OR disabled_until > now()))';

/**
 * THE ONE STATEMENT THAT RECORDS THAT A CREDENTIAL CHECK SUCCEEDED.
 *
 * ## WHY IT IS NOT `recordActivity`, AND WHY IT MUST NOT BECOME IT
 *
 * `last-activity.ts` argues at length what "activity" means in this architecture:
 * an **observed** re-authentication, written by four routes, read by the
 * dormant-account retention scan. `last_login_at` answers a different question —
 * "when did a password last pass a check" — and `0023`'s column comment is explicit
 * that collapsing the two is a defect rather than a simplification: "collapsing them
 * would let a broad activity signal overwrite an authentication fact."
 *
 * That is not a style preference, it is a count. A refresh, a logout and a password
 * reset are all activity and **none of them is a credential check**, so the four
 * writers of `last_activity_at` must stay four writers, and this column must get
 * exactly one: `issueSession`, on the branch where the password matched. Writing it
 * from `refresh` would let anyone holding a stolen refresh token keep an account's
 * authentication clock current indefinitely.
 *
 * ## WHY `now()` IS IN THE STATEMENT AND NOT IN ITS PARAMETERS
 *
 * `0023` states this as a requirement rather than a preference — "the writing path
 * supplies it from its own `now()`, never from a caller, so a caller cannot backdate
 * or postdate its own sign-in". A caller-supplied value here would let a request
 * decide when its own sign-in happened, on a column whose entire purpose is to be
 * believed by whoever reads it in an incident review.
 *
 * ## WHY THERE IS NO `authz.record_user_login()` SEAM — A RECORDED GAP, NOT AN OVERSIGHT
 *
 * `authz.record_user_activity()` exists for three reasons (`0017:198-217`): the
 * timestamp is not the caller's, the write is **named** rather than pasted into
 * three call sites, and `EXECUTE` is granted to `app_admin` alone. An inline
 * statement written this way keeps the first — `now()` is called by the database, in
 * the statement — and the third is already true at the grant layer (`app_member`
 * holds no `UPDATE` on `users` at all, `0008:465-466`, and `app_anon` has no table
 * grant), so the seam would guard a boundary that is already closed by grants.
 *
 * What it does **not** buy is the name, and that is the half that matters over
 * time: this is a second writer of a second column on the row `0017`'s function
 * already writes, which is the shape `0017` was written to avoid arriving one
 * column later. The honest fix is a `0025` adding `authz.record_user_login(uuid)`
 * beside the existing one, and it is not written here because this unit was scoped to
 * `src/` and a migration is a schema change whose reviewer must own the decision.
 * Stated in the file rather than left in a diff, because a gap that only appears in
 * a diff is the same gap with better PR archaeology.
 *
 * ## WHY `deleted_at IS NULL` IS IN THE `WHERE`
 *
 * `0017` refuses to stamp `last_activity_at` on a tombstone and gives the reason:
 * "the clock on a scrubbed row must not restart". The argument is *stronger* here,
 * because this column is an authentication fact rather than an activity estimate —
 * an investigator asking "was this account in use last Tuesday" must not be
 * answered by an anonymised row that something touched after erasure.
 */
export const RECORD_LAST_LOGIN_SQL = 'UPDATE users SET last_login_at = now() WHERE id = $1 AND deleted_at IS NULL';

interface RefreshTokenRow {
  readonly id: string;
  readonly user_id: string;
  readonly jti: string;
  readonly expires_at: string | Date;
  readonly revoked_at: string | Date | null;
  readonly rotated_to: string | null;
}

/**
 * Login orchestration (rebase.md W11 slice 3).
 *
 * One database pool per process, but the security boundary is per login: the
 * pool connects as `pgrst_authenticator` — the only role allowed to
 * impersonate the serving roles — and each login transaction runs
 * `SET LOCAL ROLE app_admin` before any user/refresh-token/attempt write.
 * Claims alone cannot buy write access, because the app_admin branch of the
 * policy discriminates on `current_user`, never on a token field (§B2/§B5).
 * This is exactly the seed's escalation boundary.
 *
 * The role claim is chosen as: `app_admin` when the user holds the seeded
 * system capability role `admin`, otherwise `app_member`. The claim selects
 * the PostgREST DB role; capability stays in `roles`/`role_permissions` and
 * is resolved by `has_permission()` — never baked into the token (§B5).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly env: Environment;

  constructor(
    config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly tokens: TokenService,
    private readonly captcha: CaptchaService,
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
  ) {
    this.env = config.getOrThrow<Environment>('environment');
  }

  /**
   * POST /auth/login. The generic 401 is deliberate: an unknown username and
   * a wrong password produce the same body, so the response does not leak
   * whether the account exists.
   *
   * **A disabled account produces that same body too**, for the same reason and by
   * the same constant — see `INVALID_CREDENTIALS_MESSAGE`. Of the four answers that
   * message covers, three are decided further down in `issueSession`; what lives here
   * is everything that has to happen *before* any of them, and the blocked case in
   * particular has to answer identically while having run no credential check at all.
   *
   * Slice 3 ordering (security.md): every attempt writes its audit row in
   * its own committed transaction *before* any credential check, the
   * throttle gate (delay or block) runs next, and only then the password is
   * compared. A blocked attempt never reaches bcrypt; a delayed attempt
   * waits and then does. The generic 401 body is identical either way.
   *
   * Counter keying: the primary axis is the account (username), the
   * secondary axis the IP subnet — matching security.md's "per-account is
   * primary, IP reputation is corroborating". A successful login inserts a
   * 'succeeded' row for the same username, which resets the account
   * penalty; a success from the same IP key resets that key's penalty.
   */
  async login(dto: LoginRequestDto, ip: string | undefined): Promise<LoginResponseDto> {
    const normalizedIp = normalizeIpAddress(ip);
    const subnet = ipSubnetKey(normalizedIp);
    const allowlisted =
      normalizedIp !== '' && this.env.security.ipAllowlist.includes(normalizedIp);

    const gate = await this.gate('login', dto.username, ip, normalizedIp, subnet, allowlisted);
    if (gate.blocked) {
      // The fourth answer that shares `INVALID_CREDENTIALS_MESSAGE` with the three in
      // `issueSession`. A caller who has been rate-limited has learned only that they
      // were rate-limited — in particular, not whether the account behind the username
      // they were guessing at exists, which is the one thing the counter must never
      // become an oracle for. See `gate()` for why the row is written unconditionally.
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (gate.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, gate.delayMs));
    }

    // THE CHALLENGE, AND WHERE IT SITS.
    //
    // `docs/security.md` §Login flow ordering puts it between the block check and
    // `bcrypt.compare`, and that position is the whole point: **a challenge that
    // could be skipped by a correct password would be skipped by a correct
    // password.** So it is answered here, after the gate has said a challenge is
    // owed and before `issueSession` looks at a password at all.
    //
    // The order relative to the delay is deliberate too: the delay is the penalty
    // for the accumulated failures, and it is paid by EVERY attempt — including
    // one that fails the challenge. A bot that cannot solve the challenge still
    // waits, which is the point of having both.
    //
    // The refusal is a `428`, not the generic `401`, and it is not an enumeration
    // oracle: the gate's counter is written for every attempt against the name,
    // whether or not the account exists, so the threshold is reached at the same
    // request number either way. See `CaptchaRequiredException`.
    if (gate.captchaRequired) {
      const solved = await this.captcha.verify(dto.captchaToken ?? '', dto.captchaAnswer ?? '');
      if (!solved) {
        throw new CaptchaRequiredException();
      }
    }

    return this.issueSession(dto, gate.attemptId);
  }

  /**
   * THE brute-force gate, shared by every unauthenticated route that decides
   * whether to do expensive work for a caller.
   *
   * ## One gate, two counters, and why `kind` is a parameter rather than a second method
   *
   * `login`, `password-reset/request` and `email-verification/request` all answer
   * the same question with the same arithmetic: *how much unproven pressure is this
   * requester exerting, and how long should they wait before we do more work for
   * them?* `delayForFailures` and `isBlocked` are the whole of that arithmetic and
   * they take `SECURITY_*`, so a second gate would be the same code with a
   * different chance of drifting from the config (§2.4).
   *
   * `kind` selects which population of `login_attempts` the counters read
   * (`0019`). Without it the two routes share one budget and an unauthenticated
   * party can lock an office's sign-in page with five requests that never touch a
   * credential — see `AttemptKind`.
   *
   * ## `subject` is the caller's label for the primary axis, and it is a LIE in one case
   *
   * For a login it is a username. For a token request it is the normalised email
   * address — stored in the same `username` column, because per-subject counting is
   * the only control that stops *email bombing*, which is an attack with many source
   * addresses and one target mailbox (`§B6`: "Per-account failure counting… IP
   * reputation is a secondary signal"). A botnet's per-IP counters never trip; a
   * per-address counter trips on request three.
   *
   * It is deliberately NOT the user's `id`. Counting on an id would need the
   * account lookup first, and the whole enumeration argument rests on this running
   * *before* anything looks an account up.
   *
   * ## Ordering is a security property, not a style
   *
   * The count, the decision and the INSERT all happen in ONE committed transaction
   * that finishes before the caller does anything expensive. Two things depend on
   * that:
   *
   *  1. the audit row exists even when the request dies before bcrypt or before the
   *     mail is sent, so the attack surface is recorded either way;
   *  2. **a counter that only counted registered addresses would be an oracle.**
   *     Because the row is written unconditionally — for an address that exists and
   *     one that does not — the thresholds are reached at the same request number
   *     for both, and a `429` tells a prober nothing about the mailbox. This is
   *     asserted in `test/unit/auth/token-request.spec.ts`, and it is the reason
   *     this method takes the subject as text and not as a resolved user.
   *
   * Allowlisted source IPs are never blocked and never delayed, exactly as on the
   * login path, and their rows carry NULL canonical keys so the counters never see
   * them.
   */
  private async gate(
    kind: AttemptKind,
    subject: string,
    ip: string | undefined,
    normalizedIp: string,
    subnet: string,
    allowlisted: boolean,
  ): Promise<{ blocked: boolean; delayMs: number; attemptId: string; captchaRequired: boolean }> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const subjectFailures = await this.countRecentFailures(
        client, kind, subject, null, this.env.security.failureWindowSeconds,
      );
      const ipFailures =
        subnet === ''
          ? 0
          : await this.countRecentFailures(
              client, kind, null, subnet, this.env.security.failureWindowSeconds,
            );

      const blocked =
        !allowlisted &&
        (isBlocked(subjectFailures, this.env.security.blockThreshold) ||
          isBlocked(ipFailures, this.env.security.blockThreshold));
      const delayMs = allowlisted
        ? 0
        : Math.max(
            delayForFailures(subjectFailures, this.env.security.delayScheduleSeconds, this.env.security.delayCapSeconds),
            delayForFailures(ipFailures, this.env.security.delayScheduleSeconds, this.env.security.delayCapSeconds),
          );

      // THE RISK-SCOPED CHALLENGE, and it reads the ACCOUNT's count and not the
      // ADDRESS's.
      //
      // `docs/security.md` §Brute force names two anti-patterns: a hard lock after
      // N failures, and a "blanket CAPTCHA on threshold" — "attacker deliberately
      // trips the threshold so legitimate users get challenged. Behind CGNAT, one
      // corporate NAT challenges hundreds."
      //
      // The address count is the one that produces the second anti-pattern: a
      // shared egress address reaches the threshold and every person behind it is
      // challenged, for an attack none of them made. The account count cannot do
      // that — it is about ONE name — and it is the axis §B6 makes primary
      // ("Per-account failure counting is primary. IP reputation is a secondary
      // signal"). So the challenge is keyed on the account, and the address axis
      // keeps the job it already had: shedding volume.
      //
      // THE COUNT IS WRITTEN FOR EVERY ATTEMPT AGAINST THE NAME, whether or not
      // the account exists, so this branch cannot become an enumeration oracle: a
      // name that does not exist reaches the threshold at the same request number
      // as one that does.
      //
      // An allowlisted address is not counted at all — its rows carry NULL
      // canonical keys — so its count is zero and it is never challenged. The
      // `!allowlisted` is belt and braces over a property the counters already
      // have.
      const captchaRequired =
        !allowlisted && subjectFailures >= this.env.security.captchaThreshold;

      const tracked = !allowlisted && subnet !== '';
      const attemptId = await this.recordAttempt(
        client,
        kind,
        subject,
        ip ?? null,
        tracked ? normalizedIp : null,
        tracked ? subnet : null,
        'failed',
      );
      await client.query('COMMIT');
      committed = true;
      return { blocked, delayMs, attemptId, captchaRequired };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Phase 2: bcrypt, then tokens. The audit row from phase 1 is flipped
   * to 'succeeded' only on a real success; a rejected password leaves the
   * optimistic 'failed' row in place.
   *
   * ## WHY THE DISABLE IS CHECKED HERE AND NOT BEFORE `bcrypt.compare`
   *
   * Three properties depend on this being the *last* conjunct of one condition rather
   * than a guard clause above the lookup, and each one is a way the obvious
   * implementation leaks:
   *
   *  1. **Timing.** A check placed above the compare answers in the time of two indexed
   *     lookups instead of the time of a cost-12 bcrypt (~324ms idle, measurably over a
   *     second on a loaded box). That is a *faster* answer for exactly the requests
   *     where the account exists and is switched off — which is the same oracle as a
   *     distinct message, arriving over a channel the message argument never sees. The
   *     `UNKNOWN_USER_PASSWORD_HASH` canary above exists to equalise the two
   *     account-shaped cases; a pre-compare check would reintroduce the asymmetry it
   *     removes.
   *  2. **The audit row.** `gate()` already committed a `'failed'` row for this attempt,
   *     and the statement that would flip it to `'succeeded'` is the first one after this
   *     `if`. A disabled account therefore leaves exactly what a wrong password leaves
   *     — one tracked `'failed'` row — so a party hammering a disabled account is still
   *     counted against the §B6 per-account failure budget and still shows up in the
   *     ledger. A refusal that returned before this point would be recorded too (the row
   *     is already committed), but a refusal placed above `gate()` would be recorded
   *     nowhere at all.
   *  3. **The counter.** Refusing earlier cannot accidentally *exempt* the attempt from
   *     the throttle, because the throttle has already run either way. Putting the
   *     disable check below the compare also means the disabled account keeps paying
   *     the delays, which is the honest signal: the traffic is still unproven pressure
   *     aimed at that name.
   *
   * ## WHY THE THROW IS THE SAME STATEMENT, NOT A SECOND ONE
   *
   * The condition is one `if` with one `throw` and one message constant, so "the disable
   * is answered differently from a wrong password" is not a convention a future author has
   * to remember, it is a shape the code cannot express. Two `if`s with two messages would
   * differ the moment one of them was edited, and it would differ in exactly the
   * direction §2.1 warns about: the account state readable from the response, with a
   * test suite that was asserting the *message* of each branch independently and so
   * stayed green on both.
   */
  private async issueSession(
    dto: LoginRequestDto,
    attemptId: string,
  ): Promise<LoginResponseDto> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const user = await this.findUser(client, dto.username);
      // Unknown usernames still cost one bcrypt compare (against the canary),
      // so the CPU cost is equal whether or not the account exists. The canary
      // never matches, so the outcome is still "no match" for unknown users.
      const candidate = user?.password_hash ?? UNKNOWN_USER_PASSWORD_HASH;
      const passwordOk = await bcrypt.compare(dto.password, candidate);

      // `user.is_disabled` is the FOURTH reason for one refusal, decided by the database
      // in the SELECT above — and last in the condition so that its cost is paid after
      // the compare, never instead of it.
      if (user === undefined || !passwordOk || user.is_disabled) {
        await client.query('COMMIT');
        committed = true;
        throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
      }

      await client.query("UPDATE login_attempts SET status = 'succeeded' WHERE id = $1", [attemptId]);
      const dbRole = await this.dbRoleFor(client, user.id);
      const accessToken = await this.mintAccessToken(user, dbRole);
      const issued = await this.issueRefreshToken(client, user, accessToken.jti);
      // The FIRST observation an account ever gets, and the reason a row created by
      // this migration is eligible for the dormant-account purge at all: a column
      // that is never written is NULL forever, and NULL is never eligible (`0017` §1).
      // Rides in this transaction, so it costs no round trip.
      await recordActivity(client, user.id);

      // A CREDENTIAL CHECK SUCCEEDED. One statement, one column, and deliberately NOT
      // the one above: `last_activity_at` is what the application OBSERVED and
      // `last_login_at` is what the PASSWORD PROVED. See `RECORD_LAST_LOGIN_SQL`.
      //
      // **A failure here fails the sign-in, and that is the decision rather than an
      // accident.** The write rides inside the transaction that is already minting the
      // tokens, so there is exactly one outcome available: a statement that errors
      // aborts it, nothing is committed, no token is issued, and the request ends in a
      // `500` rather than a session. That is §2.3's obligation met without a
      // `try`/`catch` at all — the alternative is a catch that logs and returns `200`,
      // which is precisely the "a sign-in succeeded but its audit write did not" state
      // this unit is asked to treat as a different thing from a sign-in.
      //
      // It costs no availability this route did not already carry: the statement above
      // is `authz.record_user_activity()`, an `UPDATE` on this same table in this same
      // transaction, so whatever can break this one has already broken that one, and
      // the failure would have been a `500` regardless.
      //
      // A ZERO-ROW result is not an error and is not treated as one, which is
      // `recordActivity`'s documented single `false` answer. The row was read a few
      // statements ago and is **not** locked by this transaction, so the one reachable
      // cause is an erasure landing in between — and for a row that has stopped existing
      // the correct value of `last_login_at` is NULL, not a stamp and not a `500`.
      // Failing the request over it would be a login-path error for an account nobody is
      // going to keep, which `last-activity.ts` already argues is noise dressed as a
      // check.
      await client.query(RECORD_LAST_LOGIN_SQL, [user.id]);

      await client.query('COMMIT');
      committed = true;
      return {
        accessToken: accessToken.value,
        refreshToken: issued.token,
        tokenType: 'Bearer',
        expiresIn: this.env.jwt.accessTokenTtlSeconds,
      };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Failures counted toward the gate: recent failed rows whose canonical
   * keys are set (allowlisted or untracked-IP rows carry NULL keys and
   * count for nothing). The counter resets at the most recent 'succeeded'
   * row for the same key — a party that proves the password clears the
   * penalty, which is the only reset security.md allows.
   *
   * **`kind` is in BOTH the outer predicate and the reset subquery, and omitting
   * it from either is a different bug.** The outer one is the isolation: a login's
   * failures must not be counted against a token request. The inner one is
   * subtler — a `token_request` population contains no `'succeeded'` row at all,
   * so the subquery correctly finds nothing and the counter never self-clears,
   * which is the only reason the limit is reachable. Point that subquery at the
   * whole table and a *login* success anywhere on the host would reset an
   * unrelated mailbox's bomb budget.
   */
  private async countRecentFailures(
    client: PoolClient,
    kind: AttemptKind,
    username: string | null,
    subnet: string | null,
    windowSeconds: number,
  ): Promise<number> {
    if (username === null && subnet === null) {
      throw new Error('countRecentFailures needs one key');
    }
    if (username !== null) {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM login_attempts
         WHERE username = $1 AND attempt_kind = $2 AND status = 'failed' AND ip_normalized IS NOT NULL
           AND created_at >= now() - make_interval(secs => $3)
           AND created_at > COALESCE(
             (SELECT max(created_at) FROM login_attempts
               WHERE username = $1 AND attempt_kind = $2 AND status = 'succeeded'),
             '-infinity'::timestamptz)`,
        [username, kind, windowSeconds],
      );
      return result.rows[0]?.count ?? 0;
    }
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM login_attempts
       WHERE ip_subnet = $1 AND attempt_kind = $2 AND status = 'failed' AND ip_subnet IS NOT NULL
         AND created_at >= now() - make_interval(secs => $3)
         AND created_at > COALESCE(
           (SELECT max(created_at) FROM login_attempts
             WHERE ip_subnet = $1 AND attempt_kind = $2 AND status = 'succeeded'),
           '-infinity'::timestamptz)`,
      [subnet, kind, windowSeconds],
    );
    return result.rows[0]?.count ?? 0;
  }

  /**
   * POST /auth/refresh. The presented refresh token is looked up by its
   * sha256 hash. A live token rotates: the old row is revoked and linked to
   * the new row, the new row carries the new access token's jti, and the
   * new access token's role claim is re-read from the user's *current* DB
   * role, so a revocation since login takes effect within one token lifetime.
   *
   * A presented token that is already rotated or revoked is replay evidence:
   * the whole `rotated_to` family is revoked, live leaf included, and the
   * caller gets the same generic 401 a garbage token gets.
   *
   * ## WHY A DISABLED ACCOUNT IS REFUSED HERE TOO
   *
   * **This is the second of the two places the rule is enforced, and not a
   * restatement for completeness.** Sign-in is where an account first proves a
   * credential; refresh is where a session keeps proving one, indefinitely, without ever
   * touching a password again. A disable enforced only on `login` is a disable with a
   * fuse the length of one access token: the account holder already holds an unexpired
   * bearer token and a live refresh token, and a route that never re-reads the account
   * state lets them mint a fresh one every thirty seconds for as long as they keep
   * presenting the old one. "Cannot sign in" is not "disabled" — it is "may not start
   * a session", which is what the login check alone would enforce.
   *
   * Login and refresh are the only two ways an unproven caller becomes a proven one in
   * this architecture, so those two are the whole of the boundary. The *access-token*
   * window is the residual and is stated rather than papered over: a disable does not
   * revoke tokens already issued and does not reach PostgREST (§B1 — PostgREST is the
   * API layer and this process never sees its requests), so an account switched off
   * mid-session stays usable until its current access token expires. Closing that window
   * needs token revocation at the `db-pre-request` hook, which is a separate unit with
   * its own §B2 F1 argument.
   */
  async refresh(dto: RefreshRequestDto): Promise<RefreshResponseDto> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const tokenHash = createHash('sha256').update(dto.refreshToken).digest('hex');
      const result = await client.query<RefreshTokenRow>(
        'SELECT id, user_id, jti, expires_at, revoked_at, rotated_to FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      );
      const row = result.rows[0];

      if (row === undefined) {
        throw new UnauthorizedException('invalid refresh token');
      }

      if (row.revoked_at !== null || row.rotated_to !== null) {
        await this.revokeFamily(client, row.id);
        await client.query('COMMIT');
        committed = true;
        throw new UnauthorizedException('invalid refresh token');
      }

      if (new Date(row.expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException('invalid refresh token');
      }

      const user = await this.findUserById(client, row.user_id);
      if (user === undefined || user.is_disabled) {
        // The same 401 as an unknown, revoked, replayed or expired token, for the same
        // reason `INVALID_CREDENTIALS_MESSAGE` gives on the login route: a caller who
        // learns that their refresh failed *because the account is switched off* has
        // learned three things — that the account exists, that it is under security
        // action, and which of the reasons applies. `0023`'s vocabulary makes the third
        // of those a four-way answer, so this is a shortlist rather than an existence
        // bit.
        //
        // **The token is deliberately NOT consumed, and that falls out of the ordering
        // rather than being a decision somebody implemented.** The throw happens before
        // the rotation, so the transaction rolls back with the `FOR UPDATE` lock and no
        // write to `refresh_tokens` at all: the row is byte-for-byte as it was. That is
        // the right direction for a *temporary* disable — an account suspended for an
        // hour resumes with the token it already had instead of needing to sign in
        // again — and it is why the re-enable path is a column update rather than an
        // un-revocation.
        //
        // Note the asymmetry with the replay branch above, which DOES commit before it
        // throws: replay evidence is something this route must act on, and a disabled
        // account is not.
        throw new UnauthorizedException('invalid refresh token');
      }

      const dbRole = await this.dbRoleFor(client, user.id);
      const accessToken = await this.mintAccessToken(user, dbRole);
      const issued = await this.issueRefreshToken(client, user, accessToken.jti);
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now(), rotated_to = $2 WHERE id = $1',
        [row.id, issued.id],
      );
      // A refresh is the observation a read-heavy session actually produces: it is
      // the event that crosses the access-token boundary, and it is the reason a user
      // who only ever READS through PostgREST is still recorded as active. See
      // `last-activity.ts` for what this does not see.
      await recordActivity(client, user.id);

      await client.query('COMMIT');
      committed = true;
      return {
        accessToken: accessToken.value,
        refreshToken: issued.token,
        tokenType: 'Bearer',
        expiresIn: this.env.jwt.accessTokenTtlSeconds,
      };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * POST /auth/logout. Revokes the presented token and its whole family.
   * Idempotent and existence-agnostic: an unknown or already-revoked token
   * gets the same empty 204 as a live one, so logout cannot probe whether a
   * refresh token is valid.
   *
   * A logout is an observation like any other re-authentication event, and it is
   * recorded for the same reason `refresh` is: it is the moment the user told us
   * something about themselves. An account that logs out and never returns is
   * exactly the account the dormant-account purge is for, so recording this LAST
   * event is what starts that clock honestly rather than at the previous refresh.
   */
  async logout(dto: LogoutRequestDto): Promise<void> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const tokenHash = createHash('sha256').update(dto.refreshToken).digest('hex');
      const result = await client.query<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      );
      const row = result.rows[0];
      if (row !== undefined) {
        await this.revokeFamily(client, row.id);
        await recordActivity(client, row.user_id);
      }

      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // =============================================================================
  // THE ONE-TIME-TOKEN ROUTES
  //
  // Four public routes over the `src/token/` primitive: request a link for an
  // address, and redeem one. The primitive already guarantees the things that are
  // hard to retrofit — domain-separated HMAC storage, single use, expiry, and
  // purpose separation at the type level and in a CHECK constraint — so nothing
  // below re-implements any of it. What is here is what only the HTTP boundary
  // can add: a throttle that runs BEFORE the account lookup, a uniform answer, and
  // a floor on how long the uniform answer takes.
  // =============================================================================

  /**
   * `POST /auth/password-reset/request` and
   * `POST /auth/email-verification/request`.
   *
   * ## THE ENUMERATION ARGUMENT, END TO END
   *
   * A registered address mints a token and hands it to a real SMTP server. An
   * unregistered one returns immediately. Everything between those two facts is
   * built to be indistinguishable, and each layer is a place the property could
   * have leaked, so each is listed with what it closes:
   *
   *  1. **Status and body are one literal.** `{ status: 'accepted' }` and `202`,
   *      returned from the same statement on both paths. No token id, no expiry,
   *      no "we emailed you", no recipient echo.
   *  2. **The gate runs BEFORE any account lookup.** See `gate()`. This is the
   *      load-bearing ordering: the counter counts rows, not accounts, so a
   *      registered address reaches `429` on exactly the same request number as an
   *      unregistered one. Reversing these two steps would turn the rate limit into
   *      the most reliable oracle on the route.
   *  3. **A transport failure does not change the status.** `TokenService.deliver`
   *      rejects when SMTP refuses, and letting that propagate would answer `500`
   *      for a registered address and `202` for an unregistered one — an oracle
   *      gated behind "can this attacker make mail fail". So the failure is caught,
   *      logged at `error`, and answered exactly like a success. **The failure is
   *      not swallowed**: `EmailService` has already written a `status = 'failed'`
   *      row to `email_messages` before it rethrows, so "was a reset attempted and
   *      did it arrive" is answerable from the database, which is the §2.3
   *      obligation. What is given up is telling the *caller*, which is the only
   *      party who cannot be told without telling an attacker something.
   *  4. **Both paths pay the floor.** `waitOutFloor` runs unconditionally. See
   *      `enumerationFloorMs` in `config/environment.ts` for what this does and
   *      does not close — it is a floor, not an equaliser.
   *
   * What remains open, stated rather than claimed as solved: a delivery that costs
   * far *more* than the floor is still slower than a miss. Closing that needs
   * constant-work SMTP or a fixed queue, neither of which is a knob.
   *
   * ## Why the subject of the counter is the address and not the user id
   *
   * Because the lookup has not happened yet, and because per-subject counting is
   * the only control that stops email bombing — an attack with many source addresses
   * and one target mailbox, where a per-IP counter never trips.
   */
  async requestToken(
    dto: TokenRequestDto,
    purpose: TokenPurpose,
    ip: string | undefined,
  ): Promise<TokenRequestAcceptedDto> {
    // Taken at the very top, so the floor covers the gate's own round trips and
    // the wait cannot be moved later to weaken it.
    const startedAtMs = Date.now();
    const subject = dto.email.trim().toLowerCase();

    const normalizedIp = normalizeIpAddress(ip);
    const subnet = ipSubnetKey(normalizedIp);
    const allowlisted =
      normalizedIp !== '' && this.env.security.ipAllowlist.includes(normalizedIp);

    const gate = await this.gate('token_request', subject, ip, normalizedIp, subnet, allowlisted);
    if (gate.blocked) {
      // Refused BEFORE the lookup, which is what makes this uniform. The message
      // names no address and no account: a caller who was rate-limited has learned
      // only that they were rate-limited.
      //
      // `HttpException` + `HttpStatus` rather than a named 429 class: Nest 12 does
      // not export one, and inventing a local subclass would be a second
      // vocabulary for a status code that already has one.
      throw new HttpException(
        'too many requests for this address or network — wait before asking again',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (gate.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, gate.delayMs));
    }

    try {
      await this.tokens.deliver({ purpose, email: subject });
    } catch (error) {
      // See (3) above. `error` is logged, never returned: an `EmailDeliveryError`
      // carries the recipient in its message and the exception chain can carry the
      // provider's, so the reason is recorded through the logger and nothing is
      // echoed into a response.
      this.logger.error(
        `a ${purpose} link for a validated address could not be delivered; the attempt is recorded in ` +
          `email_messages and the caller was told nothing different from a request that succeeded: ` +
          describeFailure(error),
      );
    }

    await this.waitOutFloor(startedAtMs);
    return { status: 'accepted' };
  }

  /**
   * `POST /auth/password-reset/confirm`.
   *
   * ## The order of the five steps, and why each one is where it is
   *
   *  1. **Redeem first.** `TokenService.redeem` is one indexed, atomic,
   *     purpose-scoped UPDATE that consumes the token or matches nothing. Hashing
   *     first would spend ~300ms of bcrypt on every forged link — turning the
   *     confirm route into a free CPU amplifier for anyone who can reach it — and
   *     would make "is my token valid" observable as a latency difference before
   *     the answer is even given.
   *  2. **Refuse uniformly.** Expired, consumed, wrong-purpose and never-issued all
   *     produce `RedeemTokenResult.status === 'invalid_or_expired'`, and all four
   *     become the same `400`. See `UNUSABLE_TOKEN_MESSAGE`.
   *  3. **Hash once, at `BCRYPT_COST`.** The same cost the login canary uses, so a
   *     stored hash costs what a compared one costs. The plaintext never reaches
   *     the statement — it is the `$1` of a parameterised UPDATE, and it is not
   *     logged, not returned and not written anywhere else.
   *  4. **One transaction for the password, the sessions and the activity stamp.**
   *    A reset that changed the password but left the old sessions alive would be
   *    the worst of both: the legitimate user is locked out *and* whoever prompted
   *    the reset keeps working. Revocation rides in the same transaction so there
   *    is no window in which the new password is in force beside the old sessions.
   *  5. **Burn the other links, after the commit.** See `invalidateOtherResetLinks`.
   *
   * ## What a reset records
   *
   * `refresh_tokens.revoked_at` on every live row is the audit trail, and it is a
   * trail this repository already keeps for every other session kill — `logout`
   * writes the same column and `refresh` writes it on rotation. No table was
   * invented for this, and the number revoked is the value returned below.
   *
   * ## No throttle here, and that is a deliberate omission
   *
   * `§B6` names three routes for rate limiting and this is not one of them: the
   * request route is `forgot-password`, and it carries the gate. A *guess* at this
   * route is one HMAC-SHA256 over 32 bytes of entropy plus one indexed lookup that
   * matches nothing, so a per-attempt limit would buy no protection while making
   * every legitimate confirmation wait behind a counter nobody can exhaust. The
   * expensive step — bcrypt — runs only after a token has already been consumed.
   */
  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<PasswordResetConfirmedDto> {
    const redeemed = await this.tokens.redeem({
      rawToken: dto.token,
      expectedPurpose: 'password_reset',
    });
    if (redeemed.status === 'invalid_or_expired') {
      throw new BadRequestException(UNUSABLE_TOKEN_MESSAGE);
    }
    const { userId } = redeemed.token;
    if (userId === null) {
      throw unusableTokenWithoutSubject('password_reset');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      // `AND deleted_at IS NULL`: `TokenService.deliver` only mints for a live
      // account, but a link minted before a retention purge or an erasure can be
      // redeemed after it, and writing a password onto a tombstone is a row this
      // route has no business producing.
      const updated = await client.query(
        'UPDATE users SET password_hash = $2 WHERE id = $1 AND deleted_at IS NULL',
        [userId, passwordHash],
      );
      if (updated.rowCount !== 1) {
        // The token is spent and the account is not there to reset. Two causes, and
        // the distinction matters to whoever reads the log rather than to the caller:
        // `auth_tokens.user_id` cascades on hard delete (`0018` §1A), so a redeemed
        // token naming a missing row is a delete that landed between the redemption
        // and this statement; a row present but soft-deleted is an erasure that
        // landed in the same window. Neither is a bad link, and answering `400`
        // would blame the caller for it — so this is a 500 that names what happened.
        throw new Error(
          `a redeemed password-reset token named user ${userId} and no live account was there to update`,
        );
      }

      // Every live session dies. `AND revoked_at IS NULL` keeps the count honest:
      // the returned number is what actually changed, which is what the tests
      // assert against, rather than "no error was raised".
      const revoked = await client.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
      );
      // Read and reported rather than discarded: "did terminating the sessions
      // actually terminate them" is the first question asked after a reset, and the
      // only honest answer is the row count. `pg` types this `number | null`, and a
      // null here would print as "null sessions revoked" instead of hiding.
      const revokedCount = revoked.rowCount ?? 0;

      // A reset is a re-authentication: the user proved control of a mailbox, which
      // is strictly stronger evidence than a password, and an account that reset
      // and vanished is exactly what the dormant-account purge exists to find.
      // Rides in this transaction, so it costs no round trip.
      await recordActivity(client, userId);

      const email = await this.emailOf(client, userId);

      await client.query('COMMIT');
      committed = true;

      const burnedLinks = await this.invalidateOtherResetLinks(email);
      this.logger.log(
        `password reset completed for user ${userId}: ${String(revokedCount)} live session(s) revoked, ` +
          `${String(burnedLinks)} outstanding reset link(s) closed`,
      );
      return { status: 'password_reset' };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * `POST /auth/email-verification/confirm`.
   *
   * ## What it does, and what it pointedly does not do
   *
   * It stamps `users.email_verified_at`. It does NOT gate anything on that column,
   * and `login` does not read it — `issueSession` decides on the password and on
   * nothing else, so verification and sign-in are two independent facts about an
   * account rather than one gate that forgot to open.
   *
   * That consistency is deliberate in the direction it points. Adding a "must be
   * verified" rule here or in `issueSession` would give every pre-existing account
   * (all of them `NULL` in the new column) a sign-in they cannot perform, and would
   * make this route confer a capability no other route agrees it confers.
   * `0020_users_email_verified_at.sql` argues it at length.
   *
   * ## No floor, deliberately
   *
   * There is no timing floor here, and the asymmetry with the request route is the
   * point. The property being defended on the request route is "does this mailbox
   * exist"; the attacker gets to choose the token, and the only thing a slow or fast
   * answer would tell them is whether the token they already hold was real — which
   * they learn from the `400` or the `200` regardless. Padding a success by 250ms
   * would buy nothing and make the happy path slower for every user.
   */
  async confirmEmailVerification(
    dto: EmailVerificationConfirmDto,
  ): Promise<EmailVerificationConfirmedDto> {
    const redeemed = await this.tokens.redeem({
      rawToken: dto.token,
      expectedPurpose: 'email_verification',
    });
    if (redeemed.status === 'invalid_or_expired') {
      throw new BadRequestException(UNUSABLE_TOKEN_MESSAGE);
    }
    const { userId } = redeemed.token;
    if (userId === null) {
      throw unusableTokenWithoutSubject('email_verification');
    }

    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      // The same `deleted_at` guard as the reset, for the same reason: confirming an
      // address on an erased account writes a claim about an account that has been
      // asked to stop existing.
      const stamped = await client.query(
        'UPDATE users SET email_verified_at = now() WHERE id = $1 AND deleted_at IS NULL',
        [userId],
      );
      if (stamped.rowCount !== 1) {
        throw new Error(
          `a redeemed email-verification token named user ${userId} and no live account was there to stamp`,
        );
      }

      await client.query('COMMIT');
      committed = true;
      return { status: 'verified' };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Burns every OTHER live password-reset link for this account.
   *
   * ## Why this is not optional
   *
   * A one-time token is single-use, and "single-use" is a statement about ONE link.
   * A user who asked for three resets holds three links, and after redeeming one
   * the other two are still live — so an attacker who got hold of an older mail
   * (a shared mailbox history, a forwarded thread, a backup) can still set the
   * password *after* the legitimate user has, and the user will believe they chose
   * the final value. Redeeming a link must close the set it belongs to.
   *
   * ## Why it is outside the transaction, and why that is safe
   *
   * `TokenService` holds its own pool, so this cannot join the transaction above
   * without either a second pool in one request or a hand-written UPDATE that
   * bypasses the `authz` seam `0018` deliberately built. The seam wins; the cost is
   * that this is a second, short step after the password change is already durable.
   *
   * **That ordering is the safe direction.** The window in which another reset link
   * still works is one that closes; the alternative — failing the whole reset
   * because the burn could not run — would leave the user locked out of their own
   * account, which is the worse of the two outcomes by a wide margin.
   *
   * **A failure here is fatal to the request, not swallowed.** The password is
   * already changed and the caller must not be told the reset succeeded while a
   * second live link remains.
   *
   * @returns how many links it closed. Zero is the ordinary case: the token just
   *   redeemed is the only live one, and `authz.invalidate_auth_tokens` only
   *   touches rows with `consumed_at IS NULL`, so the redeemed one is not counted.
   */
  private async invalidateOtherResetLinks(email: string): Promise<number> {
    return this.tokens.invalidateSubjectTokens(email, 'password_reset');
  }

  /** The address `hashSubject` was keyed on, for the reset-link burn. Read inside the caller's transaction. */
  private async emailOf(client: PoolClient, userId: string): Promise<string> {
    const result = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    const email = result.rows[0]?.email;
    if (email === undefined) {
      throw new Error(`user ${userId} was updated one statement ago and has no address to key the token burn on`);
    }
    return email;
  }

  /**
   * Holds the response until at least `SECURITY_ENUMERATION_FLOOR_MS` has passed,
   * and is called on the request route for BOTH the registered and the unregistered
   * answer.
   *
   * The unconditional call is the design. A pad that ran only on the miss would
   * (a) put the "did this branch exist?" decision in the shape of the code, and
   * (b) leave the two distributions separated above the floor rather than below it.
   * `setTimeout` never fires early, so the elapsed time is a floor and not a
   * promise — which is why this is asserted as `>=` and never as an exact value.
   */
  private async waitOutFloor(startedAtMs: number): Promise<void> {
    const remainingMs = this.env.security.enumerationFloorMs - (Date.now() - startedAtMs);
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
  }

  /** Revokes every unrevoked row reachable from `startId` in both directions. */
  private async revokeFamily(client: PoolClient, startId: string): Promise<void> {
    const chain = await this.familyChainIds(client, startId);
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL',
      [chain],
    );
  }

  /**
   * Walks the `rotated_to` chain from the presented token: forward to the
   * live leaf, backward to the original, in both directions to the ends.
   * A Set guards against cycles.
   */
  private async familyChainIds(client: PoolClient, startId: string): Promise<string[]> {
    const ids = new Set<string>([startId]);
    const queue: string[] = [startId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      const forward = await client.query<{ rotated_to: string | null }>(
        'SELECT rotated_to FROM refresh_tokens WHERE id = $1',
        [current],
      );
      const next = forward.rows[0]?.rotated_to;
      if (typeof next === 'string' && !ids.has(next)) {
        ids.add(next);
        queue.push(next);
      }
      const backward = await client.query<{ id: string }>(
        'SELECT id FROM refresh_tokens WHERE rotated_to = $1',
        [current],
      );
      for (const row of backward.rows) {
        if (!ids.has(row.id)) {
          ids.add(row.id);
          queue.push(row.id);
        }
      }
    }
    return [...ids];
  }

  /**
   * The credential row, by id. Carries `is_disabled` so the refresh path refuses a
   * disabled account from the statement it was already making, rather than adding a
   * second lookup whose only content would be account state.
   */
  private async findUserById(client: PoolClient, userId: string): Promise<UserRow | undefined> {
    const result = await client.query<UserRow>(
      `SELECT id, username, password_hash, ${DISABLED_ACCOUNT_PREDICATE_SQL} AS is_disabled
         FROM users WHERE id = $1`,
      [userId],
    );
    return result.rows[0];
  }

  /**
   * The credential row, by username. **This statement is the only place account state is
   * read on the sign-in path** — the disable predicate rides in the `SELECT` list rather
   * than arriving as a second column read afterwards.
   *
   * It rides in the same statement rather than as a separate
   * `SELECT disabled_at, disabled_until FROM users WHERE id = …` because that alternative
   * is the one worth refusing, and it is worse rather than merely longer: a separate read
   * returns two timestamps into this process, and any decision taken on them here is a
   * decision against **this machine's** clock. Folding the predicate into the statement
   * keeps the comparison on the database's `now()` and keeps it on the same snapshot as
   * the `password_hash` it is deciding beside — two statements could see two states of
   * one row, and "the row was enabled when we read the hash" is not a sentence anybody
   * should have to reason about.
   *
   * Both readers use the one exported predicate, because the alternative is two copies
   * of an expression whose correctness is the whole of the clock argument above.
   */
  private async findUser(client: PoolClient, username: string): Promise<UserRow | undefined> {
    const result = await client.query<UserRow>(
      `SELECT id, username, password_hash, ${DISABLED_ACCOUNT_PREDICATE_SQL} AS is_disabled
         FROM users WHERE username = $1`,
      [username],
    );
    return result.rows[0];
  }

  /**
   * Writes the attempt row. `attemptKind` is BOUND, not interpolated, and it is
   * the only thing keeping the two populations of this table apart — the caller
   * passes a closed union, so there is no string reaching the statement that a
   * caller could shape.
   */
  private async recordAttempt(
    client: PoolClient,
    attemptKind: AttemptKind,
    subject: string,
    ip: string | null,
    ipNormalized: string | null,
    ipSubnet: string | null,
    status: 'failed' | 'succeeded',
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      'INSERT INTO login_attempts (attempt_kind, username, ip, ip_normalized, ip_subnet, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [attemptKind, subject, ip, ipNormalized, ipSubnet, status],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('login attempt insert did not return an id');
    }
    return id;
  }

  private async dbRoleFor(client: PoolClient, userId: string): Promise<string> {
    const result = await client.query<{ holds: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND r.name = 'admin' AND r.is_system_role = true
       ) AS holds`,
      [userId],
    );
    return result.rows[0]?.holds === true ? 'app_admin' : 'app_member';
  }

  private async mintAccessToken(
    user: UserRow,
    dbRole: string,
  ): Promise<{ value: string; jti: string }> {
    // §B5: the claim must be asserted on mint. Only the three serving DB
    // roles may ever be named; anything else is an issuer bug, not a token.
    const allowed = new Set(['app_anon', 'app_member', 'app_admin']);
    if (!allowed.has(dbRole)) {
      throw new Error('refusing to mint a token with a non-serving role claim');
    }
    // v7, matching the `uuidv7()` defaults the schema uses for every other key, so
    // a `jti` and a row id are the same kind of value and both sort by minting time.
    const jti = uuidv7();
    const value = await this.jwtService.signAsync({ sub: user.id, role: dbRole, jti });
    return { value, jti };
  }

  private async issueRefreshToken(
    client: PoolClient,
    user: UserRow,
    jti: string,
  ): Promise<{ token: string; id: string }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + this.env.jwt.refreshTokenTtlSeconds * 1000);
    const result = await client.query<{ id: string }>(
      'INSERT INTO refresh_tokens (user_id, jti, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.id, jti, tokenHash, expiresAt],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('refresh token insert did not return an id');
    }
    return { token, id };
  }
}

/**
 * A failure reason safe to write to the log.
 *
 * Mirrors `email.service.ts`'s own helper for the same reason and with the same
 * shape: a non-`Error` is stringified rather than discarded, because "the provider
 * threw something we cannot describe" is a real state and an empty log line reads
 * as "no failure recorded". `String()` on an arbitrary thrown value can only ever
 * produce its `toString`, which for a token-bearing payload object is `[object
 * Object]` — so nothing credential-shaped reaches the log through this path.
 */
function describeFailure(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : `a non-Error value: ${String(error)}`;
}
