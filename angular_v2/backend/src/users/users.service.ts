import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import { BCRYPT_COST } from '../auth/auth.service.js';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard.js';
import { EmailService } from '../email/email.service.js';
import { PostgrestClient } from '../postgrest/postgrest-client.js';
import { TokenService } from '../token/token.service.js';
import { UNUSABLE_TOKEN_MESSAGE } from '../token/unusable-token-message.js';
import { normalizePendingEmail } from '../token/email-change-token.js';
import { recordActivity } from '../auth/last-activity.js';
import type { ChangePasswordDto } from './change-password.dto.js';
import type { CreatedUserDto } from './created-user.dto.js';
import type { CreateUserDto } from './create-user.dto.js';
import type { EmailChangeAcceptedDto } from './email-change-accepted.dto.js';
import type { EmailChangeConfirmDto } from './email-change-confirm.dto.js';
import type { EmailChangeConfirmedDto } from './email-change-confirmed.dto.js';
import type { EmailChangeRequestDto } from './email-change-request.dto.js';
import type { LoginAttemptDto } from './login-attempt.dto.js';
import type { UpdateProfileDto } from './update-profile.dto.js';
import type { UserProfileDto } from './user-profile.dto.js';

/**
 * The twelve columns `app_member` may read on `users`.
 *
 * **The list is written out here and nowhere else**, because it is simultaneously
 * three things that must agree and only two of them are the database's:
 *
 *   1. the `select=` list of every read a member makes of their own row;
 *   2. the columns the `RETURNING` clause of the name write names;
 *   3. the shape `UserProfileDto` describes.
 *
 * `0023_user_profile_and_disable.sql:687-692` is where the list comes from, and it is
 * the member's COLUMN GRANT — so a name added here that is not in the grant makes the
 * member's own read fail outright rather than return one field too many. That is why
 * `readProfileRow` refuses a row carrying a key this list does not name, instead of
 * spreading it: a passthrough would make a future column silently appear in the profile
 * response, and the frontend's `ProfileMe` `Pick` would then be describing a shape the
 * server stopped guaranteeing.
 *
 * **A column-restricted role cannot use `select=*`** (`0008:475-481`), so naming the
 * columns is not politeness — a `select=*` here is a `403` for every member.
 */
export const MEMBER_PROFILE_COLUMNS: readonly string[] = [
  'id',
  'username',
  'email',
  'created_at',
  'country_code',
  'region_code',
  'city',
  'geo_source',
  'geo_accuracy_km',
  'geo_updated_at',
  'first_name',
  'last_name',
];

/**
 * How many of a member's own attempt rows this endpoint will return.
 *
 * **A bound, not a paginator.** The response is a bare array — §B3 reserves the
 * `{ items, total, page }` envelope for a shared helper and forbids hand-rolling one,
 * and a hand-rolled envelope for a single unbounded read would be a second thing to
 * keep in step. `ORDER BY created_at DESC, id DESC LIMIT 50` answers the question the
 * page asks — "what has been happening to this account" — with the newest first, and
 * the cap is what stops one long-lived account from asking the thin app to materialise
 * its whole history.
 *
 * 50 is not a security threshold and so is not config: it is a page size. §B6's "all
 * thresholds come from config" is about the values that decide how hard a caller is
 * pushed, and a page size is not one.
 *
 * `id DESC` is the tie-break and it is the right one because every key in this schema
 * is a `uuidv7()` default (`§B1`), so the id orders by minting time and two attempts
 * stamped in the same transaction still come back in a defined order.
 */
export const LOGIN_HISTORY_LIMIT = 50;

/**
 * The credential rows this service reads for itself: id, username, email, and the
 * hash on the two paths that need it.
 *
 * Read under `SET LOCAL ROLE app_admin`, so `password_hash` is reachable — see
 * `asAppAdmin` for why that is the escalation boundary rather than a grant.
 */
type CredentialRow = {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly password_hash: string;
};

/**
 * SQLSTATE values this service translates, named once.
 *
 * `23514` is `check_violation` and `23505` is `unique_violation`. Both arrive here as
 * a caller's input violating a rule the DATABASE owns, and both are answers rather than
 * faults: surfacing them as `500` would tell a member their own name was blank by way
 * of a server error page. `pg` puts the code on `DatabaseError.code`; a non-`pg`
 * failure has no such property and therefore never matches, which is the safe
 * direction — an unrecognised failure stays a `500`.
 */
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

/** A failure safe to write to the log. Mirrors `auth.service.ts`'s own helper. */
function describeFailure(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : `a non-Error value: ${String(error)}`;
}

/** `pg`'s SQLSTATE, when the value is a `DatabaseError`. Never a cast. */
function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { readonly code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * The member's own profile, and the three things they may change.
 *
 * ## TWO WAYS IN, AND THE DIFFERENCE IS THE WHOLE OF §B1
 *
 * The reads that need the caller's OWN privileges go through `PostgrestClient`, which
 * replays their already-verified bearer token so PostgREST sets `request.jwt.claims`
 * and PostgreSQL resolves `authz.actor()` to them. That is the identity seam, it is
 * the only mechanism in this repository that lets a policy see who is asking, and
 * `users_read_scope` (`0008:399-404`, rewritten by `0009:329`) is what answers. The
 * consequence is that a member's read is bounded by their COLUMN GRANT as well as by
 * the policy, which is precisely why `UserProfileDto` is exactly twelve fields.
 *
 * `AGENTS.md` §B1 also says PostgREST serves CRUD over a table and this tree adds no
 * controller for anything expressible as CRUD — so it is worth being explicit about
 * why this controller exists at all. Every route here is either
 *
 *   * **an algorithm the database cannot express** — bcrypt verification, a two-phase
 *     token redemption, a progressive decision, or the mapping of a database refusal
 *     onto an HTTP status; or
 *   * **a read of a table the serving role holds NO grant on** — `login_attempts`, where
 *     §B6's "admin-only, and that is deliberate" rules out PostgREST entirely and the
 *     thin app reads it elevated instead; or
 *   * **a write the member's grant deliberately withholds** — `app_member` holds no
 *     `UPDATE` on `users` at all (`0023:629-634`), so the name write is the thin app's
 *     job and not CRUD.
 *
 * None of them is CRUD a client could have issued directly, which is the test §B1 sets.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
    private readonly postgrest: PostgrestClient,
    private readonly tokens: TokenService,
    private readonly email: EmailService,
  ) {}

  // =============================================================================
  // 1. GET /api/users/me
  // =============================================================================

  /**
   * The caller's own row, read with the caller's own privileges.
   *
   * ## THE `id = eq.<sub>` FILTER IS REDUNDANT WITH THE POLICY, AND IT IS STILL HERE
   *
   * `users_read_scope` already admits only the actor's own row (or every row, for
   * `app_admin`), so the filter changes nothing for a member. It is written anyway
   * because it makes the route's own correctness independent of the policy's: the
   * `sub` comes from the verified token and is the ONLY thing this method was asked to
   * read, so "the read cannot be widened by anything the caller supplies" is a property
   * of the statement as well as of the schema. An administrator's own token gets the
   * same treatment — `app_admin` sees every row, and this route still returns one.
   *
   * ## A MISSING ROW IS A `404`, AND IT IS NOT AN ERROR CONDITION TO HIDE
   *
   * Zero rows means one of three real things: the account does not exist, it has been
   * anonymised (`0009:329` hides a tombstone from its own subject), or it holds no role
   * and so fails `authz.can_read_user()`. All three are correctly "there is no profile
   * here", and all three are reported rather than answered `200 []`, because a profile
   * page rendering an empty card is indistinguishable from a working one.
   */
  async me(userId: string, callerToken: string | undefined): Promise<UserProfileDto> {
    // The token is what makes the read the CALLER's, and `JwtAuthGuard` sets it on the
    // same assignment that sets `req.user` — so reaching here without one is not
    // reachable through HTTP. It is checked rather than assumed because the alternative
    // failure is a confusing one: `PostgrestClient` omits the header on an empty token,
    // PostgREST then serves the read as `app_anon`, and the answer is a `403` naming a
    // table rather than a token that was never forwarded.
    if (callerToken === undefined || callerToken === '') {
      throw new UnauthorizedException(
        'this request reached the self-read with no verified bearer token to forward; JwtAuthGuard sets it on ' +
          'the same assignment that sets req.user, so this is not reachable from an HTTP request',
      );
    }

    const rows = await this.postgrest.get<unknown>(callerToken, '/users', {
      params: {
        select: MEMBER_PROFILE_COLUMNS.join(','),
        id: `eq.${userId}`,
      },
    });
    const data: unknown = rows.data;
    if (!Array.isArray(data)) {
      throw new Error(
        `PostgREST answered the self-read of ${userId} with ${rows.status} and a body that is not an array; ` +
          'a member profile read that cannot be parsed must fail loudly rather than render as an empty profile',
      );
    }
    const first: unknown = data[0];
    if (first === undefined) {
      throw new NotFoundException('no profile is readable for this token');
    }
    return readProfileRow(first);
  }

  // =============================================================================
  // 2. PATCH /api/users/me
  // =============================================================================

  /**
   * `first_name` and `last_name`, on the caller's own row, and nothing else.
   *
   * ## WHY THIS DOES NOT GO THROUGH POSTGREST, WHICH IS THE INTERESTING PART
   *
   * PostgREST would be the obvious route for a CRUD update, and it cannot perform this
   * one. `app_member` holds **no** `UPDATE` on `users` — `0023:629-634` re-states it,
   * and it is a decision with a reason attached: giving a member a write verb here would
   * need a per-column `UPDATE` grant *and* a `WITH CHECK` pinning `id`, so that a member
   * could not rewrite their own `created_at` or repoint `id` at another row. So the
   * member's own name is written by the thin app, which owns password hashing and email
   * re-verification for exactly this class of change.
   *
   * ## THE SPEC'S `WITH CHECK` IS NOT AVAILABLE HERE, AND WHAT STANDS IN ITS PLACE
   *
   * The brief names "a `WITH CHECK` that pins `id` to the actor" as the mechanism. That
   * mechanism lives in a RLS policy, and `users_update` is `USING (current_user =
   * 'app_admin')` (`0008:421`) — so this route runs under the one role whose policy
   * admits every row. A `WITH CHECK` would have to be added by a migration that also
   * grants `app_member` the column-level `UPDATE`, and this unit writes no migration.
   *
   * What stands in its place is deliberately narrow and stated rather than implied:
   *
   *   * `id = $1`, where `$1` is `AccessTokenPayload.sub` — the id the VERIFIED TOKEN
   *     carried. It is not a path parameter, not a body field and not a query
   *     parameter, so no caller can express "update user B" on this route. That is the
   *     same unrepresentable-not-merely-checked property `PrivacyController.erase` has
   *     and argues for at length.
   *   * The `SET` list is a CONSTANT. Both assignments are written out with a `CASE` that
   *     carries a "was this field supplied" flag and a value, so the statement's shape
   *     never varies and nothing a caller supplies reaches the SQL text — only ever a
   *     parameter. An earlier draft assembled the list from the two column names and
   *     interpolated it, which `test/unit/claims-write-surface.spec.ts` refuses: it reads
   *     `SET` followed by `${` as "a setting name built by interpolation", and the rule
   *     exists because a payload inside a string has to be read as a payload. The `CASE`
   *     form is also simply better — one statement, one plan, and `null` still clears a
   *     column because the cast is explicit.
   *   * `AND deleted_at IS NULL`, matching what `users_read_scope` does for the read
   *     path (`0009:332`), so this write cannot put a name on a tombstone.
   *
   * **The migration that would make the second bullet structural is named here so the
   * gap is a decision with an owner rather than a silence:** a `0025` that grants
   * `UPDATE (first_name, last_name)` on `users` to `app_member` and rewrites
   * `users_update` with `USING (id = authz.actor())`. It is not written here because it
   * is a schema change, and a migration whose reviewer must own the decision is not
   * something a controller change can smuggle in.
   *
   * ## THE DATABASE SAYS NO AND THE CLIENT HEARS 422
   *
   * `users_first_name_not_blank` / `users_last_name_not_blank` (`0023:216-251`) reject
   * `''`, `' '` and `'CA '`. That arrives as `23514`, and it is translated here into a
   * `422` with the rule named — because "the database refused a value" is a validation
   * answer about the member's own input, and letting it surface as a `500` would report
   * a server fault for the most ordinary thing a person can get wrong on a form.
   *
   * `RETURNING` names the same twelve columns as the read, so the `200` is what the
   * DATABASE stored rather than what the client submitted. A form that echoed its own
   * input would report success for a value the server trimmed, refused or normalised —
   * and `frontend/.../profile-api.service.ts` says exactly that it relies on this.
   *
   * ## "WAS THIS FIELD SUPPLIED" IS `!== undefined`, AND `hasOwnProperty` IS WRONG HERE
   *
   * The obvious test — `Object.prototype.hasOwnProperty.call(dto, 'first_name')` — is
   * what an earlier draft used, and it answers `true` for a field the client never sent.
   * `tsconfig.json` targets `ES2023`, so `useDefineForClassFields` is on and every field
   * `UpdateProfileDto` declares is DEFINED on each instance, with the value `undefined`.
   * The global `ValidationPipe` runs `transform: true`, so `dto` is such an instance
   * (`plainToInstance(UpdateProfileDto, {})` has both own properties). The draft
   * therefore read every body as "both supplied": `{}` was answered `200` after writing
   * `NULL` to both columns, and `{ first_name: 'Ada' }` silently cleared `last_name` —
   * a data-loss bug on the one route whose `200` promises it is what the database
   * stored. `test/e2e/profile.e2e-spec.ts` caught it as the empty-body case answering
   * `200`.
   *
   * `!== undefined` is exact rather than approximate: the body is JSON, and JSON has no
   * `undefined`, so a value that is `undefined` here is a key the client did not send.
   * `null` is a value JSON DOES carry, and it still reaches the `CASE` as "supplied, and
   * clear it", which is the `null`-clears-a-name rule `UpdateProfileDto` documents.
   */
  async updateMe(userId: string, dto: UpdateProfileDto): Promise<UserProfileDto> {
    const setFirst = dto.first_name !== undefined;
    const setLast = dto.last_name !== undefined;
    if (!setFirst && !setLast) {
      throw new UnprocessableEntityException('nothing to change: send first_name, last_name, or both');
    }

    const client = await this.pool.connect();
    let committed = false;
    let profile: UserProfileDto;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const updated = await client.query<Record<string, unknown>>(
        `UPDATE users
            SET first_name = CASE WHEN $2::boolean THEN $3::text ELSE first_name END,
                last_name  = CASE WHEN $4::boolean THEN $5::text ELSE last_name END
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING ${MEMBER_PROFILE_COLUMNS.join(', ')}`,
        [userId, setFirst, setFirst ? (dto.first_name ?? null) : null, setLast, setLast ? (dto.last_name ?? null) : null],
      );
      const returned: unknown = updated.rows[0];
      if (updated.rowCount !== 1 || returned === undefined) {
        throw new NotFoundException('no profile is writable for this token');
      }
      // Mapped INSIDE the transaction, from the row this statement just wrote. Reading
      // it here rather than re-reading it is not only one round trip: it is the only way
      // the `200` can be the value the DATABASE stored, including the timestamp format,
      // because `readProfileRow` is the single place either reader's row becomes a DTO.
      profile = readProfileRow(returned);

      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      if (sqlStateOf(error) === CHECK_VIOLATION) {
        throw new UnprocessableEntityException(
          'a name may not be blank or carry leading or trailing whitespace — send null to clear it instead',
        );
      }
      throw error;
    } finally {
      client.release();
    }

    return profile;
  }

  // =============================================================================
  // 3 + 4. THE ADDRESS CHANGE — TWO PHASES, AND THE ORDER IS THE CONTROL
  // =============================================================================

  /**
   * `POST /api/users/me/email`. **PHASE ONE: nothing about the account changes.**
   *
   * ## WHY NOTHING IS WRITTEN HERE — THE ACCOUNT-TAKEOVER ARGUMENT, IN FULL
   *
   * The obvious implementation of "change my email address" is one statement:
   * `UPDATE users SET email = $new`, plus a mail to the new address. That is a takeover
   * in two requests, and it is worth spelling the sequence out because every step of it
   * looks legitimate:
   *
   *   1. the member (or whoever holds their session) points the account at
   *      `attacker@example.test`. Every subsequent mail goes there.
   *   2. that party asks for a password reset. `TokenService.deliver` looks the account
   *      up by the address on file — which is now the attacker's — finds it, and mails
   *      the reset link to the attacker.
   *   3. the attacker redeems it and owns the account. The real owner is locked out of
   *      the address they no longer receive mail at, and the reset link they would have
   *      got from step 2 never existed.
   *
   * So this route writes NOTHING to `users`. It mints a one-time token bound to the
   * member AND carrying the address they asked for, delivers it to that address, and
   * stops. `users.email` still holds the old address, mail still goes there, and step 2
   * of the attack above mails the real owner. The address moves in
   * `confirmEmailChange`, and only after the link has been opened out of the new
   * mailbox — which is the proof that the member controls it.
   *
   * The pending address therefore lives in the TOKEN and nowhere else. See
   * `src/token/email-change-token.ts` for why it is not a column on `users`, why it is
   * not a column on `auth_tokens`, and how the token authenticates the address it
   * carries.
   *
   * ## THE ORDER OF THE FOUR STEPS, AND EACH ONE'S REASON
   *
   *   1. **Read the caller's row** and refuse if it is gone. Without it the "already your
   *      address" and "already on another account" checks below have nothing to compare
   *      against, and the first would have to be a second query anyway.
   *   2. **Refuse two no-op or harmful requests** — the address is already the member's
   *      own, or a *live* account already holds it. The second is a decision rather than
   *      a schema requirement: `users.email` is NOT UNIQUE, so the database would accept
   *      it, and `TokenService.deliver`'s account lookup is `WHERE lower(email) = $1
   *      LIMIT 1` — so two accounts on one address make the password-reset link for that
   *      mailbox go to whichever row the planner reaches first. Refusing keeps the reset
   *      path's subject unambiguous, which matters more here than the absence of the
   *      constraint. (This is `422`, not `409`: the request is well-formed and the
   *      resource state refuses it, and the frontend renders a `422` body.)
   *   3. **Supersede, then mint.** Neither is inside the transaction above, for the
   *      reason `AuthService.invalidateOtherResetLinks` gives: `TokenService` holds its
   *      own pool, so it cannot join a transaction this service opened without either a
   *      second pool in one request or a hand-written INSERT that bypasses the `authz`
   *      seam `0018` deliberately built. The seam wins. The order is load-bearing —
   *      superseding AFTER the mint would burn the token that was just created — and
   *      both run after the checks have committed, so a refusal above costs no token and
   *      burns no link.
   *   4. **Send, and let a delivery failure propagate.** There is no enumeration
   *      defence on this route to protect — the caller is authenticated and knows their
   *      own account — so the `TokenRequestAcceptedDto` pattern of catching a transport
   *      failure and answering `202` anyway would be §2.3's "silently returning a
   *      success-shaped value" here. `EmailService` has already written a `status =
   *      'failed'` row to `email_messages` before it rethrows, so the attempt is
   *      auditable either way. The token stays unconsumed and unexpired; the member's
   *      next request supersedes it.
   *
   * ## RESIDUAL, STATED: TWO REQUESTS INSIDE ONE ROUND-TRIP WINDOW BOTH SURVIVE
   *
   * Superseding is not serialised against minting, and the reason is the seam above: the
   * supersede and the mint are two transactions on two connections, so two concurrent
   * requests from the same member can both run their supersede before either mints, and
   * both links survive. Sequential requests — which is what a person does — always end
   * with exactly one live link, and that is the case the brief's supersede requirement is
   * about. Closing the window needs a migration that lets a caller-supplied transaction
   * reach `authz.mint_auth_token`, so the mint can join the transaction that already holds
   * the member's row; that is a schema decision and is not this unit's to make.
   *
   * ## RECORDED GAP — THE OWNER OF THE OLD ADDRESS IS NOT TOLD, AND THAT IS A REAL HOLE
   *
   * The two-phase ordering closes the reset-route takeover above completely. It does
   * **not** close the case where the party making the request already holds a valid
   * session: they request the change, open the link in the mailbox they now control, and
   * the address moves — after which they own a password reset they did not have to ask
   * for. Nothing in this unit notices, because nothing in this unit watches the account's
   * mail.
   *
   * The control that closes it is a notification to the OLD address, and it is NOT here
   * for a reason worth stating rather than hiding: it needs a design of its own (what
   * the recipient does with the mail — a cancel link? a re-request? nothing? — and what
   * happens when the old address is itself dead), and a half-designed second flow is §2.1
   * in a new place. **Until it exists, this endpoint is safe against an unsolicited
   * change and incomplete against one made from a stolen session.** That is the honest
   * description, and `test/e2e/profile.e2e-spec.ts` asserts everything short of it.
   */
  async requestEmailChange(userId: string, dto: EmailChangeRequestDto): Promise<EmailChangeAcceptedDto> {
    const pendingEmail = normalizePendingEmail(dto.email);

    const client = await this.pool.connect();
    let committed = false;
    let username: string;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const account = await this.readCredentialRow(client, userId);
      if (account === undefined) {
        throw new NotFoundException('no profile is writable for this token');
      }
      username = account.username;

      if (normalizePendingEmail(account.email) === pendingEmail) {
        throw new UnprocessableEntityException('that is already the address on file');
      }

      const taken = await client.query<{ taken: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2 AND deleted_at IS NULL) AS taken',
        [pendingEmail, userId],
      );
      if (taken.rows[0]?.taken === true) {
        throw new UnprocessableEntityException('another live account already uses that address');
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

    // Supersede, then mint — both AFTER the checks above have committed, and both on
    // `TokenService`'s own pool. See step 3 for why that ordering and that boundary.
    //
    // A supersede that throws is fatal to the request and is NOT swallowed, which is
    // `confirmPasswordReset`'s discipline: the member asked for their address to be
    // replaced, and answering `202` while an older link is still live would tell them
    // the pending change is the only one when it is not.
    const superseded = await this.tokens.invalidateEmailChangeTokens(userId);
    if (superseded > 0) {
      this.logger.log(
        `an outstanding address-change request for user ${userId} was superseded by a newer one ` +
          `(${String(superseded)} link(s) closed)`,
      );
    }

    const minted = await this.tokens.mintEmailChange({ userId, pendingEmail });

    try {
      await this.email.sendEmailChangeEmail(
        pendingEmail,
        username,
        pendingEmail,
        minted.rawToken,
        userId,
      );
    } catch (error) {
      this.logger.error(
        `the address-change link for user ${userId} could not be delivered to the requested address; the ` +
          `attempt is recorded in email_messages and the caller was told the request failed rather than a ` +
          `202: ${describeFailure(error)}`,
      );
      throw error;
    }

    return { accepted: true };
  }

  /**
   * `POST /api/users/me/email/confirm`. **PHASE TWO: this is where `email` moves.**
   *
   * `@Public()`, and the token is the authentication — which is the same argument
   * `AuthController` makes for its four link routes and the same consequence. A member
   * whose address is wrong is, by definition, the person least able to authenticate to
   * anything: they are signed out, locked out, or reading mail on a device that is not
   * this browser. Requiring a session AS WELL as the link would demand a second proof of
   * a thing the first proof already establishes, and would make the flow impossible in
   * the one case it exists for.
   *
   * ## WHAT MAKES THE REDEMPTION AUTHORISED
   *
   * Three things, and none of them is the request body:
   *
   *   1. `TokenService.redeemEmailChange` consumes the token atomically and only for a
   *      row whose `subject_hmac` is THIS member's change namespace.
   *   2. The address comes out of the token's authenticated payload, so the `UPDATE`
   *      cannot be pointed at an address the token does not commit to.
   *   3. The `id` comes from the row the token names — which `mintEmailChange` bound to
   *      the verified `sub` of the request. Nothing in this method reads a body field
   *      for a subject.
   *
   * ## WHY THE DUPLICATE CHECK IS REPEATED HERE
   *
   * `requestEmailChange` refuses an address another live account holds. That check is
   * three seconds of an attacker-free window wide at worst, and the window is the whole
   * point of repeating it: `redeem` has already consumed the token by the time this
   * statement runs, so a refusal here costs the member their link and they re-request
   * against a different address — which is the right trade against writing a second
   * account onto an address the reset path resolves with `LIMIT 1`.
   *
   * ## A TOKEN WITH NO LIVE ACCOUNT IS A `500`, AND IT IS NOT A BAD LINK
   *
   * `auth_tokens.user_id` cascades on hard delete (`0018:22`) and a tombstone is not
   * live, so a link minted before an erasure can be redeemed after it. Writing an
   * address onto a row that has been asked to stop existing is a fault in this
   * application, not a caller error, so it is thrown rather than answered as a refusal.
   */
  async confirmEmailChange(dto: EmailChangeConfirmDto): Promise<EmailChangeConfirmedDto> {
    const redeemed = await this.tokens.redeemEmailChange(dto.token);
    if (redeemed.status === 'invalid_or_expired') {
      // The same sentence, and the same `400`, as the other two redemption routes. See
      // `src/token/unusable-token-message.ts`: four failure modes, one answer.
      throw new UnprocessableEntityException(UNUSABLE_TOKEN_MESSAGE);
    }
    const { userId, pendingEmail } = redeemed;

    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const taken = await client.query<{ taken: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2 AND deleted_at IS NULL) AS taken',
        [pendingEmail, userId],
      );
      if (taken.rows[0]?.taken === true) {
        throw new UnprocessableEntityException(
          'another live account uses that address now, so the change was not applied — request one again',
        );
      }

      // `email_verified_at = now()` in the SAME statement as the address, because the
      // two are one fact: opening a link out of the new mailbox is the proof that the
      // member controls it. The old address's stamp does not carry over — it described a
      // mailbox mail no longer goes to, and keeping it would record a verified fact about
      // the wrong address.
      const moved = await client.query(
        'UPDATE users SET email = $2, email_verified_at = now() WHERE id = $1 AND deleted_at IS NULL',
        [userId, pendingEmail],
      );
      if (moved.rowCount !== 1) {
        throw new Error(
          `a redeemed email-change token named user ${userId} and no live account was there to move`,
        );
      }

      // The subject proved they still receive mail at the address that now matters.
      // `authz.record_user_activity()`, same shape as the reset path.
      await recordActivity(client, userId);

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

    return { status: 'email_changed' };
  }

  // =============================================================================
  // 5. POST /api/users/me/password
  // =============================================================================

  /**
   * The member changes their own password. `204`, and nothing in the body.
   *
   * ## A WRONG `current_password` IS A 422 AND NEVER A 401 — THE STATUS IS THE DESIGN
   *
   * `401` on this application means one thing: **the bearer token was refused.**
   * `JwtAuthGuard` answers it for a missing, malformed, expired or wrongly-signed token,
   * and nothing else answers it. The frontend's `authInterceptor` acts on exactly that —
   * a `401` on a request that carried a token clears the session and navigates to
   * `/access-denied`.
   *
   * So a `401` here would mean: *mistype your own password and you are signed out.* The
   * member would be thrown to a "session over" page by a typo, and "your current
   * password is wrong" and "your session has ended" would be the same screen. `422` is
   * the status for "the request was understood and its content refused", which is what
   * a wrong password is, and it reaches the form that made the call.
   *
   * This is not a preference about status codes; it is the reason `profile-failure.ts`
   * documents the same rule from the client side.
   *
   * ## ONE BCRYPT COMPARISON, AGAINST THE SAME HASH THE LOGIN PATH READS
   *
   * `bcrypt.compare` against `users.password_hash`, read in the transaction below. No
   * second comparison against a canary, because unlike `POST /auth/login` this route
   * cannot be used to probe for accounts: the caller is already authenticated and the
   * row is already resolved, so there is no existence question to equalise.
   *
   * **The new hash is computed BEFORE the comparison**, which is the opposite of the
   * order a reader expects and is deliberate. The new password must be hashed either way,
   * and on this route an attacker who already holds a session can make it happen
   * repeatedly — so paying the cost unconditionally doubles what every attempt costs
   * rather than only the successful ones, and it is the same order
   * `confirmPasswordReset` uses (hash, then open the transaction). The alternative —
   * compare first, hash only on success — is friendlier to the server and no safer: the
   * compare is already the expensive half, and a caller who has the session can have it
   * either way.
   *
   * ## HASHED WITH `BCRYPT_COST` — THE SAME CONSTANT, NOT A SECOND POLICY
   *
   * `BCRYPT_COST` is imported from `auth.service.ts` rather than retyped, for the reason
   * its own docstring gives: a cost that drifts between the sign-in path and the
   * password path is a timing oracle that exists on only one of them, and a stored hash
   * must cost what a compared one costs.
   *
   * ## EVERY EXISTING SESSION DIES, INCLUDING THE CALLER'S OWN — AND THAT IS THE DECISION
   *
   * One statement, exactly the one `confirmPasswordReset` uses:
   * `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS
   * NULL`. It rides in the same transaction as the password write, so there is no window
   * in which the new password is in force beside the old sessions.
   *
   * **The caller's own session is included, deliberately.** The alternative — keep the
   * current family alive, revoke the rest — is friendlier and is what most products do,
   * and it is refused here for one reason: this route is the one a member reaches
   * *because* something is wrong with their account, so the session making the request is
   * the one most likely to be the attacker's. A change that leaves it alive hands back
   * the thing the change was made to end. The stated consequence is that the `204` is
   * the last thing that session does, and the frontend will sign the member out on its
   * next call — which is a truthful answer about a revoked session and not a bug.
   *
   * `AND revoked_at IS NULL` keeps the returned count honest: it is what actually
   * changed, which is what the log below reports and what a test asserts.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const passwordHash = await bcrypt.hash(dto.new_password, BCRYPT_COST);

    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const account = await this.readCredentialRow(client, userId);
      if (account === undefined) {
        throw new NotFoundException('no profile is writable for this token');
      }

      const currentMatches = await bcrypt.compare(dto.current_password, account.password_hash);
      if (!currentMatches) {
        // Rolled back by the `catch` below: the transaction wrote nothing before this
        // point, and there is deliberately no `login_attempts` row here either. See
        // §RATE LIMITING below for why writing one would be a falsified audit column.
        throw new UnprocessableEntityException(
          'the current password is not the one on file',
        );
      }

      const updated = await client.query(
        'UPDATE users SET password_hash = $2 WHERE id = $1 AND deleted_at IS NULL',
        [userId, passwordHash],
      );
      if (updated.rowCount !== 1) {
        throw new NotFoundException('no profile is writable for this token');
      }

      const revoked = await client.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
      );
      const revokedCount = revoked.rowCount ?? 0;

      await recordActivity(client, userId);

      await client.query('COMMIT');
      committed = true;

      this.logger.log(
        `password changed for user ${userId}: ${String(revokedCount)} live session(s) revoked, including the ` +
          'session that made the request',
      );
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
  // 6. GET /api/users/me/login-attempts
  // =============================================================================

  /**
   * The caller's OWN attempt rows, most recent first.
   *
   * ## WHY THE MATCH IS BY USERNAME, AND WHY THE ABSENCE OF `user_id` IS NOT A BUG
   *
   * `login_attempts` has **no `user_id` column** and no foreign key to `users`
   * (`0002:86-101`). That is deliberate and it is the design: an attempt against a
   * username that does not exist still has to be recorded, because an invalid username
   * is both an attack signal (something is guessing your accounts) and a debugging aid.
   * A `user_id NOT NULL` foreign key would make the ledger unwritable for exactly the
   * rows that matter most — the guesses — so the table is UNSCOPED and keyed by
   * `username`.
   *
   * The consequence is that the username is the STABLE KEY for a real account's
   * attempts, which is why a rename would split one person's history across two keys
   * and silently reset their §B6 per-account counter. `authz.guard_username_immutable`
   * (`0023:382-420`) makes that impossible — the column cannot change except through the
   * erasure rewrite, which rewrites the attempts too and preserves the pairing. So the
   * match below does not fragment, and it does not need a `user_id` to not fragment.
   *
   * ## WHY THIS DOES NOT GO THROUGH POSTGREST — A MEMBER HOLDS NO GRANT ON THIS TABLE
   *
   * `app_member` holds **nothing** on `login_attempts` (`0002:135-138`), behind
   * `USING (current_user = 'app_admin')`. §B6 says why in as many words: "Grant a member
   * `SELECT` and they can enumerate which accounts exist by watching for failed rows —
   * an account-enumeration oracle built out of the security log." And PostgREST serves it
   * with `openapi-mode = "ignore-privileges"`, so the relation is **addressable** in the
   * served spec regardless of the grant: a grant would make `/login_attempts` a live
   * enumeration endpoint, not merely a documented one.
   *
   * So the read is elevated instead: the same `pgrst_authenticator` +
   * `SET LOCAL ROLE app_admin` boundary every other privileged statement in this
   * application uses, bounded to `username = $1` where `$1` is read from the caller's OWN
   * `users` row inside the same transaction. Two facts make that safe:
   *
   *   * the value of the filter is never supplied by the caller — it comes from the
   *     token's `sub` via a lookup the caller cannot influence; and
   *   * a member still holds no grant, so nothing about this endpoint widens what a
   *     member can reach through the API layer. The privilege is the THIN APP's, not
   *     the caller's, which is the same distinction `auth.service.ts`'s login path makes.
   *
   * ## AND WHY ATTEMPTS AGAINST A USERNAME THAT DOES NOT EXIST ARE INVISIBLE
   *
   * The filter is an equality on one username, so a row recorded for
   * `no-such-account` can only be returned to a caller whose own username is
   * `no-such-account` — and there is no such caller, because the lookup for the caller's
   * row is what produced the value. Nobody, admin included through this route, sees them.
   * An administrator reads the whole ledger over PostgREST as `app_admin`, which is the
   * separate and intended surface.
   */
  async loginAttempts(userId: string): Promise<LoginAttemptDto[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const account = await this.readCredentialRow(client, userId);
      if (account === undefined) {
        throw new NotFoundException('no profile is readable for this token');
      }

      const attempts = await client.query<{
        id: string;
        ip: string | null;
        status: string;
        attempt_kind: string;
        created_at: Date | string;
        ip_subnet: string | null;
      }>(
        `SELECT id, ip, status, attempt_kind, created_at, ip_subnet
           FROM login_attempts
          WHERE username = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2::int`,
        [account.username, LOGIN_HISTORY_LIMIT],
      );

      await client.query('COMMIT');
      return attempts.rows.map((row) => ({
        id: row.id,
        ip: row.ip,
        status: row.status,
        attempt_kind: row.attempt_kind,
        created_at: readTimestamp(row.created_at, 'login_attempts.created_at'),
        ip_subnet: row.ip_subnet,
      }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // =============================================================================
  // 7. POST /api/users
  // =============================================================================

  /**
   * An administrator creates an account.
   *
   * ## THE THIN APP REFUSES THIS ROUTE TO A MEMBER, AND WHY IT IS NOT THE ENFORCEMENT
   *
   * §F7 is explicit that a frontend permission check is a UX affordance and the backend
   * is authoritative — and the authoritative answer here is the schema: `users_insert`
   * is `WITH CHECK (current_user = 'app_admin')` (`0008:420`) and `GRANT INSERT ON users`
   * names only `app_admin` (`0023:602`). A member's insert is refused by the database
   * whatever this method does.
   *
   * The check below is therefore a **fast, honest refusal with a message a human can
   * act on**, not a second mechanism pretending to be the first: it reads the `role`
   * claim, which §B5 is careful about — the claim is a DATABASE ROLE, not a capability,
   * and capability is resolved from `user_roles` — and it refuses before any hashing or
   * any statement. A thin app that will create a user for anyone who asks is a defect
   * regardless of what the database would do with the row afterwards, which is why the
   * brief asks for the check and why it is here.
   *
   * **The `role` claim is asserted against the three serving roles first**, with the same
   * allow-set `AuthService.mintAccessToken` uses, so a claim naming a table-owning role
   * is refused here rather than acted on. `403`, not `401`: the token was fine.
   *
   * ## A DUPLICATE USERNAME IS A 422 AND A DUPLICATE ADDRESS IS ALLOWED, DELIBERATELY
   *
   * `users.username` is `UNIQUE` and `users.email` is `NOT NULL` **and not unique**
   * (`0002:29-35`). So the constraint raises `23505` for a username that is taken, which
   * is translated into a `422` here rather than surfacing as a `500`; and a second
   * account may hold the same address with no objection at all.
   *
   * The asymmetry looks like an oversight and is not one. It is the same asymmetry
   * `requestEmailChange` acts on above: `TokenService.deliver` resolves an address with
   * `WHERE lower(email) = $1 … LIMIT 1`, so a shared address makes the password-reset
   * link for that mailbox go to whichever row the planner reaches first — which is a
   * reason to REFUSE a duplicate here, not a reason to accept one. The honest reading is
   * that the missing UNIQUE constraint is the gap and this endpoint should not widen it;
   * **it therefore does not check for a duplicate address either**, because a route that
   * refuses duplicates it has no basis to refuse is a new policy invented here, and a
   * migration adding the constraint is the change that settles it. What this method
   * states instead is what is true: the address column is not unique, and one address
   * may name more than one account.
   *
   * **The address is stored normalised** — trimmed and lowercased, by the same
   * `normalizePendingEmail` the change route uses, because `TokenService.deliver` matches
   * on `lower(email)` and two spellings of one mailbox is one more thing the reset path's
   * `LIMIT 1` has to be lucky about. The `201` returns what the database stored, so the
   * caller sees the normalised form rather than the form it sent.
   *
   * ## THE CREATED ACCOUNT HAS NO ROLE AND NO GROUP — A RECORDED INCOMPLETENESS
   *
   * §B2's invariant is "every user has at least one role and at least one group", and
   * this row has neither. That is not an oversight to be discovered: it is logged at
   * `warn` below, naming the two inserts that would complete it, and
   * `test/e2e/profile.e2e-spec.ts` asserts the row really has neither.
   *
   * **Nothing is invented to fill it.** Assigning `member` would be "silently creating a
   * role assignment nobody asked for", which is the outcome the brief refuses; and it
   * would be a security decision made by a route whose job is to make a row. §B2's
   * invariant also has **no mechanical enforcement anywhere** — nothing in the schema can
   * require a child row from a parent — so the invariant is currently documentation, and
   * a route that honours it silently would be the one place it looked true.
   *
   * What a caller can do with the account as it stands: sign in, and nothing else that
   * this application exposes. `dbRoleFor` gives it `app_member`, `users_read_scope`
   * requires `authz.can_read_user()`, and with no role rows that is false — so
   * `GET /users/me` returns zero rows and the new member's own profile reads as a `404`.
   * That is the "visibly incomplete" the brief offers as the honest option, and it is
   * chosen here over requiring a role and group in the body, which the five-field
   * contract does not carry.
   */
  async createUser(caller: AccessTokenPayload, dto: CreateUserDto): Promise<CreatedUserDto> {
    const servingRoles = new Set(['app_anon', 'app_member', 'app_admin']);
    if (!servingRoles.has(caller.role)) {
      throw new ForbiddenException('this token names a role that is not a serving role');
    }
    if (caller.role !== 'app_admin') {
      throw new ForbiddenException(
        'creating an account is an administrator action: the database refuses this INSERT for any other ' +
          'role (users_insert is WITH CHECK (current_user = \'app_admin\'), 0008:420)',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    const client = await this.pool.connect();
    let committed = false;
    let created: CreatedUserDto;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const inserted = await client.query<{
        id: string;
        username: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        created_at: Date | string;
      }>(
        `INSERT INTO users (username, email, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, email, first_name, last_name, created_at`,
        [dto.username, normalizePendingEmail(dto.email), passwordHash, dto.first_name ?? null, dto.last_name ?? null],
      );
      const row: unknown = inserted.rows[0];
      if (row === undefined) {
        throw new Error('the user insert reported no row and no error');
      }
      const returned = row as {
        id: string;
        username: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        created_at: Date | string;
      };
      created = {
        id: returned.id,
        username: returned.username,
        email: returned.email,
        first_name: returned.first_name,
        last_name: returned.last_name,
        created_at: readTimestamp(returned.created_at, 'users.created_at'),
      };

      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      const state = sqlStateOf(error);
      if (state === UNIQUE_VIOLATION) {
        // `users_username_key` is the only UNIQUE index on this table's inserted
        // columns, so this is the duplicate username and nothing else. `users.email` is
        // NOT unique, which is the other half of the comment above.
        throw new UnprocessableEntityException('that username is already taken');
      }
      if (state === CHECK_VIOLATION) {
        throw new UnprocessableEntityException(
          'a name may not be blank or carry leading or trailing whitespace',
        );
      }
      throw error;
    } finally {
      client.release();
    }

    this.logger.warn(
      `user ${created.id} (${created.username}) was created with NO role and NO group, so it can sign in but ` +
        'holds no capability and no scope: GET /users/me for that account reads zero rows because ' +
        "authz.can_read_user() is false with no user_roles row. Complete it with an INSERT INTO user_roles " +
        'and one into user_groups, or close the gap by carrying them in the body of this route.',
    );

    return created;
  }

  // =============================================================================
  // RATE LIMITING — WHAT §B6 ASKS FOR, AND WHY THERE IS NO COUNTER HERE
  // =============================================================================

  /*
   * §B6 requires rate limiting "registered globally and tightened per-route on the
   * routes that create or move credentials", and the brief asks for it on
   * `POST /users/me/password` and `POST /api/users` using "the repository's existing
   * throttle mechanism and the exported ThrottleSkip".
   *
   * **None of that exists in this tree, and none of it can be added under this unit's
   * constraints.** Recorded here rather than left to be discovered:
   *
   *   * There is NO globally registered rate limiter. No `ThrottlerModule`, no
   *     `@Throttle`, no `ThrottleSkip`, and `@nestjs/throttler` is not a dependency —
   *     §B6's own first clause ("registered globally") is unimplemented, so there is
   *     nothing to TIGHTEN. `@Throttle` / `ThrottleSkip` appear nowhere in `src/` or
   *     `test/`; `src/auth/throttle.ts` exports two PURE functions, `delayForFailures`
   *     and `isBlocked`, which decide from a failure COUNT; and `auth.controller.ts`
   *     carries no `@Throttle`. Adding `@nestjs/throttler` is a new dependency, which
   *     the brief forbids.
   *   * The one real mechanism is the `login_attempts` gate in
   *     `AuthService.gate`, and it is keyed on `attempt_kind`, which is
   *     `CHECK (attempt_kind IN ('login', 'token_request'))` (`0019:143`). A third
   *     kind is a migration, which this unit does not write.
   *   * **And writing a row under the existing `'login'` value would be a falsified
   *     audit column**, which is the reason this is a refusal rather than a compromise.
   *     A wrong `current_password` is not a login; recording it as `attempt_kind =
   *     'login'` would put a row in the security ledger asserting something that did not
   *     happen, and §B8 asserts on row values. The member reading their own history would
   *     see "failed login" rows for attempts that were not logins.
   *
   * ## WHAT ACTUALLY BOUNDS THESE TWO ROUTES, STATED SO IT IS NOT DISCOVERED
   *
   *   * `POST /users/me/password` is authenticated. Every attempt costs one bcrypt
   *     compare at `BCRYPT_COST` — the same cost `/auth/login` pays — so the route is
   *     self-limiting to roughly one guess per compare, and **the identical secret is
   *     already gated at `/auth/login`** with both the progressive delay and the block,
   *     on the `login` budget for that account. There is no cheaper path to the password
   *     here than the one that already has the counter.
   *   * `POST /api/users` is authenticated and administrator-only, and it **never
   *     compares a credential at all** — the password is hashed and stored. There is
   *     therefore no guessing surface to rate-limit. What it does have is a volume
   *     question ("how many accounts can an administrator create"), and that is an audit
   *     question answered by the rows themselves, not a throttle.
   *
   * The two changes that would close this properly, for whoever owns them: a
   * `@nestjs/throttler` registration with per-route overrides, or a `0025` adding
   * `'password_change'` to the `attempt_kind` CHECK so the failure can be counted in a
   * counter of its own without lying about what it was.
   */

  // =============================================================================
  // PRIVILEGED READS
  // =============================================================================

  /**
   * The caller's own credential row, inside a transaction that has already opened.
   *
   * `password_hash` is in the projection because two of the routes above need it, and
   * neither of them could be answered from a projection that did not carry it — the
   * alternative is a second statement per route for a value this one already has.
   *
   * `AND deleted_at IS NULL` is the tombstone guard every other writer in this tree uses
   * (`auth.service.ts`'s reset, `erasure.service.ts`'s anonymisation): a row that has been
   * asked to stop existing is not something this application writes to, reads a
   * credential from, or reports a profile for.
   */
  private async readCredentialRow(client: PoolClient, userId: string): Promise<CredentialRow | undefined> {
    const result = await client.query<CredentialRow>(
      'SELECT id, username, email, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId],
    );
    return result.rows[0];
  }
}

// =============================================================================
// ROW MAPPING — the twelve-field profile, once, for both read paths
// =============================================================================

/**
 * A `timestamptz` as one string, whichever reader produced it.
 *
 * **The two readers disagree, and normalising is the point.** PostgREST serialises a
 * `timestamptz` as `2026-01-01T12:00:00+00:00`; `pg` hands the same column back as a
 * JavaScript `Date`. So `GET /users/me` and the `200` of `PATCH /users/me` would report
 * the SAME instant in two different strings, and a client comparing the two would see a
 * difference in a field that did not change. Both go through here, so both answer in
 * `toISOString()` form and the two routes are byte-identical for an unchanged row.
 *
 * A value that will not parse throws rather than becoming `null` or the string
 * `"Invalid Date"`: a timestamp this application cannot read is a fault to report, not a
 * value to pass on (§2.3).
 */
function readTimestamp(value: Date | string, column: string): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`${column} is not a readable timestamp: ${JSON.stringify(value)}`);
  }
  return instant.toISOString();
}

/** `null` passes; anything else must be a string. */
function readNullableText(value: unknown, column: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${column} is not text or null: ${typeof value}`);
  }
  return value;
}

/** `null` passes; anything else must be an integer, which is what `0012` declares. */
function readNullableInteger(value: unknown, column: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  throw new Error(`${column} is not an integer or null: ${JSON.stringify(value)}`);
}

function readText(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${column} is not text: ${typeof value}`);
  }
  return value;
}

/**
 * A `users` row to a `UserProfileDto`, refusing anything that is not the twelve
 * columns `MEMBER_PROFILE_COLUMNS` names.
 *
 * ## WHY IT NARROWS AND CHECKS INSTEAD OF CASTING
 *
 * The value arriving here is `unknown` on purpose: one of these rows comes from
 * PostgREST's JSON and the other from `pg`, and both are checked at runtime by
 * PostgreSQL rather than by TypeScript. A cast would assert a shape nobody verified, and
 * §2.6's "use `unknown` and narrow it" is the mechanical form of that.
 *
 * The key check is what makes "exactly twelve" a property rather than a hope. A row
 * carrying a thirteenth column — or missing a twelfth — is an error, not a row to
 * render: the frontend's `ProfileMe` is a `Pick` of exactly these twelve out of the
 * generated schema, so a response that grew a key would be a shape the generated type
 * does not describe, and a response that lost one would be a field the page renders as
 * `undefined` with no error anywhere.
 *
 * It also names the column in every failure, because a profile page showing "something
 * went wrong" is the alternative this exists to avoid.
 */
function readProfileRow(row: unknown): UserProfileDto {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error('the self-read of a users row did not return an object');
  }
  const source = row as Record<string, unknown>;

  const expected = new Set(MEMBER_PROFILE_COLUMNS);
  for (const key of Object.keys(source)) {
    if (!expected.has(key)) {
      throw new Error(
        `the self-read returned a column this route does not publish: '${key}'. ` +
          'Either the column grant grew and this route must decide about it deliberately, or the read is not ' +
          'the self-read it claims to be.',
      );
    }
  }
  for (const key of MEMBER_PROFILE_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      throw new Error(`the self-read did not return the column '${key}'`);
    }
  }

  return {
    id: readText(source['id'], 'users.id'),
    username: readText(source['username'], 'users.username'),
    email: readText(source['email'], 'users.email'),
    created_at: readTimestamp(
      source['created_at'] as Date | string,
      'users.created_at',
    ),
    country_code: readNullableText(source['country_code'], 'users.country_code'),
    region_code: readNullableText(source['region_code'], 'users.region_code'),
    city: readNullableText(source['city'], 'users.city'),
    geo_source: readNullableText(source['geo_source'], 'users.geo_source'),
    geo_accuracy_km: readNullableInteger(source['geo_accuracy_km'], 'users.geo_accuracy_km'),
    geo_updated_at:
      source['geo_updated_at'] === null
        ? null
        : readTimestamp(source['geo_updated_at'] as Date | string, 'users.geo_updated_at'),
    first_name: readNullableText(source['first_name'], 'users.first_name'),
    last_name: readNullableText(source['last_name'], 'users.last_name'),
  };
}
