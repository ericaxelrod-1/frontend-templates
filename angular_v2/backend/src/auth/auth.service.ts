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
import { ipSubnetKey, normalizeIpAddress } from './ip-address.js';
import { recordActivity } from './last-activity.js';
import { delayForFailures, isBlocked } from './throttle.js';
import { uuidv7 } from './uuidv7.js';
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
 * The single message every failed redemption gets.
 *
 * **One string, four failures.** Expired, already-redeemed, presented for the
 * wrong purpose, and never issued at all all reach the same `400` with this text,
 * because `TokenService.redeem` returns one `invalid_or_expired` for all four and
 * anything that branched on which one it was would hand back the distinction the
 * primitive spent its single-use design to remove. A caller who learns *which*
 * reason their link failed has learned whether the link ever existed.
 *
 * It also says nothing about the account: a valid token does not get a friendlier
 * message either, because "that link worked" is itself the answer an attacker is
 * after and they already have it.
 */
const UNUSABLE_TOKEN_MESSAGE =
  'this link is not valid, has already been used, or has expired — request a new one';

/** A redemption that carries no user cannot reset anything, and saying so is this application's bug. */
function unusableTokenWithoutSubject(purpose: TokenPurpose): Error {
  return new Error(
    `a ${purpose} token was redeemed with no subject: the request path always mints with a user id, ` +
      'so this is not reachable from an HTTP request and must not be treated as a bad link',
  );
}

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
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
  ) {
    this.env = config.getOrThrow<Environment>('environment');
  }

  /**
   * POST /auth/login. The generic 401 is deliberate: an unknown username and
   * a wrong password produce the same body, so the response does not leak
   * whether the account exists.
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
      throw new UnauthorizedException('invalid credentials');
    }
    if (gate.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, gate.delayMs));
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
  ): Promise<{ blocked: boolean; delayMs: number; attemptId: string }> {
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
      return { blocked, delayMs, attemptId };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Phase 2: bcrypt, then tokens. The audit row from phase 1 is flipped
   * to 'succeeded' only on a real success; a rejected password leaves the
   * optimistic 'failed' row in place. */
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

      if (user === undefined || !passwordOk) {
        await client.query('COMMIT');
        committed = true;
        throw new UnauthorizedException('invalid credentials');
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
      if (user === undefined) {
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

  private async findUserById(client: PoolClient, userId: string): Promise<UserRow | undefined> {
    const result = await client.query<UserRow>(
      'SELECT id, username, password_hash FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0];
  }

  private async findUser(client: PoolClient, username: string): Promise<UserRow | undefined> {
    const result = await client.query<UserRow>(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
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
