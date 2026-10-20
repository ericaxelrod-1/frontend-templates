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
import type { PostgrestResponse } from '../postgrest/postgrest.types.js';
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
 *   2. the columns PostgREST's `RETURNING` names on the name write, which a
 *      column-restricted role has to be told explicitly or the write is refused
 *      with `42501` (`0026` §What this costs the client);
 *   3. the shape `UserProfileDto` describes.
 *
 * `0026_member_self_write.sql` is where the list comes from — it is the member's
 * COLUMN GRANT, so a name added here that is not in the grant makes the member's own
 * read fail outright rather than return one field too many, and a name REMOVED here
 * that is still in the grant makes `readProfileRow` refuse the row rather than publish
 * it. That is why `readProfileRow` refuses a row carrying a key this list does not
 * name, instead of spreading it: a passthrough would make a future column silently
 * appear in the profile response, and the frontend's `ProfileMe` `Pick` would then be
 * describing a shape the server stopped guaranteeing.
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
 *   * **an administrative write over a table the member's grant withholds entirely** —
 *     creating an account (`users_insert` is `WITH CHECK (current_user =
 *     'app_admin')`), reading a credential, or moving an address after a mailbox has
 *     answered for it.
 *
 * Note what is NOT on that list any more: `PATCH /users/me`. `0026` gave `app_member`
 * a two-column `UPDATE` grant and `users_update` the member's own row, so that write is
 * plain CRUD over a table PostgREST already serves, and it is issued as the CALLER
 * (`updateMe`) rather than elevated. It stayed on this controller because it is the
 * thin app that turns a database refusal into a `422` a form can render and because
 * §B1 reserves the controller for routes that are not expressible as bare CRUD; the
 * write itself is one PATCH.
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
   * ## IT RUNS AS THE CALLER, AND THAT IS THE WHOLE OF THE CHANGE
   *
   * This route used to open a `pg` transaction, `SET LOCAL ROLE app_admin`, and write:
   *
   *     UPDATE users SET first_name = …, last_name = …
   *      WHERE id = $1 AND deleted_at IS NULL RETURNING <twelve columns>;
   *
   * Correct, and correct by ACCOMERSE. `app_member` held no `UPDATE` on `users` and
   * `users_update` was `USING (current_user = 'app_admin')` (`0008:421`), so the write
   * ran under the one role whose policy admits every row and `id = $1` was the only
   * thing bounding it — a check that lived in this file, so a third column in the
   * `SET` list or a forgotten `id` would be silent, invisible, and refused by nothing.
   * `0026_member_self_write.sql` grants `UPDATE (first_name, last_name)` to
   * `app_member` and moves the bounding into `users_update`, and this method now goes
   * through the same seam `me()` uses so the policy is what decides.
   *
   * **Why PostgREST and not a `pg` connection.** §B2 F1: `request.jwt.claims` is a
   * caller-writable custom GUC, and the only sanctioned way for this application to
   * have a policy see who is asking is to replay the caller's already-verified token
   * into PostgREST, which verifies it, `SET ROLE`s from its `role` claim (bounded by
   * the bootstrap `GRANT`) and sets the claims inside its own transaction.
   * `test/unit/claims-write-surface.spec.ts` refuses `set_config('request.jwt.claims',
   * …)` anywhere in `src/`, so `SET LOCAL ROLE app_member` over the `pg` pool is not
   * an option at all: it would produce a policy with no actor, which denies everyone.
   * The comment `0008:457-464` predicted this exact migration and said it was owed.
   *
   * ## WHAT THE SCHEMA NOW DECIDES THAT THIS METHOD USED TO
   *
   *   * WHICH ROW — `users_update`'s `id IN (SELECT authz.actor())`. The `id=eq.<sub>`
   *     filter below is still written, for the reason `me()` writes its own: it makes
   *     this route correct independently of the policy, and `sub` comes from the
   *     VERIFIED token, so "this request cannot be pointed at user B" is a property of
   *     the statement as well as of the schema.
   *   * WHICH COLUMN — the `GRANT UPDATE (first_name, last_name)`. PostgREST turns the
   *     body into the `SET` list, so a column this route does not parse cannot be
   *     written, and the global pipe's `forbidNonWhitelisted` is the first place that
   *     is said.
   *   * WHETHER A TOMBSTONE MAY BE NAMED — `deleted_at IS NULL`, inside the policy.
   *     This method used to say it in its `WHERE`, and it can no longer: a PostgREST
   *     filter on `deleted_at` is privilege-checked like any other column reference and
   *     `deleted_at` is not in the member's twelve-column grant. Moving the rule into
   *     the policy is what makes it expressible at all, which is a better place for it
   *     than it was.
   *
   * ## THE BODY IS THE `SET` LIST, WHICH IS WHY THE `CASE` SENTENCES ARE GONE
   *
   * PostgREST writes only the keys the body carries, so "was this field supplied" is
   * answered by whether the key is present rather than by a `CASE` with a boolean flag
   * beside it. The hazard that produced the `CASE` form in the first place is
   * unchanged and is still handled where it always was: `UpdateProfileDto` declares
   * both fields, `useDefineForClassFields` writes them onto every instance as
   * `undefined`, and the global pipe runs `transform: true`, so `dto` is such an
   * instance and `hasOwnProperty` would answer `true` for a field the client never
   * sent. `!== undefined` is exact — the body is JSON and JSON has no `undefined`.
   * The key is only added to the object when the value is not `undefined`, and `null`
   * IS added, which is how "null clears a name" survives the move.
   *
   * ## `RETURNING` IS WHY `select=` IS MANDATORY AND WHY `Prefer` IS SET
   *
   * A column-restricted role cannot read `password_hash`, so PostgREST's `RETURNING`
   * clause has to name the twelve columns or the write is refused with `42501` — the
   * same rule `0008:475-481` records for reads, and it is why the response body is
   * assembled from `MEMBER_PROFILE_COLUMNS` rather than from a list written here.
   * `Prefer: return=representation` asks for the affected rows back rather than
   * PostgREST's default for `PATCH`, which is `return=minimal` and answers `204` with
   * no body — and the `200` of this route is the DATABASE's row, not the client's
   * request (`frontend/.../profile-api.service.ts` documents that it relies on
   * exactly this).
   *
   * THE SPELLING IS `return=representation`, and `return=full` DOES NOT WORK —
   * measured against the live PostgREST 16.4:
   *
   *     Prefer: return=full            -> 204, empty body
   *     Prefer: return=representation  -> 200, [{"id":"...","first_name":"..."}]
   *
   * PostgREST accepts only `minimal` and `representation`. It does not reject an
   * unknown preference with an error; it IGNORES it and applies the default, so the
   * wrong spelling is indistinguishable from not asking at all. That is why the
   * `isArray` check below is load-bearing rather than defensive: with the wrong
   * spelling the write genuinely succeeds and the response is a legitimate `204`,
   * and the only honest reading of a `204` from this route is "a write happened and
   * this method cannot report what it did".
   *
   * ## THE DATABASE SAYS NO AND THE CLIENT HEARS 422
   *
   * `users_first_name_not_blank` / `users_last_name_not_blank` (`0023:216-251`) reject
   * `''`, `' '` and `'CA '`. PostgREST carries the SQLSTATE through as `code`, so
   * `sqlStateOf` reads it and the refusal is translated into a `422` naming the rule —
   * because "the database refused a value" is a validation answer about the member's
   * own input, and letting it surface as a `500` would report a server fault for the
   * most ordinary thing a person can get wrong on a form.
   *
   * ## ZERO ROWS IS A `404`, AND IT IS NOT AN ERROR CONDITION TO HIDE
   *
   * The policy denies the write — not the grant, the POLICY — when the row is a
   * tombstone, when the caller's token resolves no actor, and when the caller is not
   * the subject the filter names. All three are correctly "there is nothing here you
   * may write", and PostgREST answers `200 []`, which is reported rather than passed
   * off as a successful write of nothing.
   */
  async updateMe(userId: string, dto: UpdateProfileDto, callerToken: string | undefined): Promise<UserProfileDto> {
    // The token is what makes the write the CALLER's, and `JwtAuthGuard` sets it on the
    // same assignment that sets `req.user`. Checked rather than assumed, for the reason
    // `me()` gives: without it `PostgrestClient` omits the header, PostgREST serves the
    // write as `app_anon`, and the answer is a `42501` naming a table rather than a
    // token that was never forwarded.
    if (callerToken === undefined || callerToken === '') {
      throw new UnauthorizedException(
        'this request reached the name write with no verified bearer token to forward; JwtAuthGuard sets it on ' +
          'the same assignment that sets req.user, so this is not reachable from an HTTP request',
      );
    }

    const body: Record<string, string | null> = {};
    if (dto.first_name !== undefined) {
      body['first_name'] = dto.first_name;
    }
    if (dto.last_name !== undefined) {
      body['last_name'] = dto.last_name;
    }
    if (Object.keys(body).length === 0) {
      throw new UnprocessableEntityException('nothing to change: send first_name, last_name, or both');
    }

    let updated: PostgrestResponse<unknown>;
    try {
      updated = await this.postgrest.patch<unknown>(callerToken, '/users', body, {
        params: {
          select: MEMBER_PROFILE_COLUMNS.join(','),
          id: `eq.${userId}`,
        },
        headers: { Prefer: 'return=representation' },
      });
    } catch (error) {
      if (sqlStateOf(error) === CHECK_VIOLATION) {
        throw new UnprocessableEntityException(
          'a name may not be blank or carry leading or trailing whitespace — send null to clear it instead',
        );
      }
      throw error;
    }

    const data: unknown = updated.data;
    if (!Array.isArray(data)) {
      throw new Error(
        `PostgREST answered the name write of ${userId} with ${updated.status} and a body that is not an array; ` +
          'a member name write that cannot be parsed must fail loudly rather than answer 200 over a write that ' +
          'did not happen',
      );
    }
    const first: unknown = data[0];
    if (first === undefined) {
      throw new NotFoundException('no profile is writable for this token');
    }
    // Mapped from the row PostgREST read back out of the database inside the write's own
    // transaction, which is the same single place `me()`'s row becomes a DTO. It is not
    // merely one round trip: it is the only way the `200` can be the value the DATABASE
    // stored, including the timestamp format.
    return readProfileRow(first);
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
   * An administrator creates an account — a COMPLETE one.
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
   * ## §B2'S INVARIANT IS HONOURED HERE, IN ONE TRANSACTION, AND NOTHING IS INVENTED
   *
   * "Every user has at least one role and at least one group." This route used to create
   * the row and log a `warn` naming the two inserts that would complete it — an account
   * that can sign in and then reads **zero rows** for `GET /users/me`, because
   * `users_read_scope` requires `authz.can_read_user()` and that is false with no
   * `user_roles` row. §2.1 calls a success-shaped report for work that did not happen the
   * worst shape available, and this was one.
   *
   * The fix is that `role` and `group` are REQUIRED on the body and the two membership
   * rows are written in the SAME transaction as the `users` row, so a `201` means an
   * account exists that can actually be used. `test/e2e/profile.e2e-spec.ts` asserts the
   * completed shape: one `user_roles` row, one `user_groups` row, and a `200` from
   * `GET /users/me` for the account that was just created.
   *
   * **Why the caller is asked rather than the route guessing, which is the decision.**
   * The three alternatives were each available and each is worse:
   *
   *   * **Invent a default** (`member`, plus some group) is what the previous version of
   *     this method refused on purpose and was right to. A role is CAPABILITY and a group
   *     is SCOPE; both are security decisions, and a route whose job is to make a row has
   *     no business making either. An account that silently holds `admin` is worse than
   *     an account that cannot read its own profile.
   *   * **Enforce it in the database** is not available here, and the reason is a
   *     property of the schema rather than an omission. `user_roles.user_id` and
   *     `user_groups.user_id` are `REFERENCES users (id)` (`0008`), so the `users` row
   *     must exist BEFORE its membership rows can name it. A `CHECK` cannot see another
   *     table at all, and a row trigger on `users` firing at INSERT time therefore cannot
   *     see membership rows that have not been written yet and cannot be — the foreign
   *     key forbids it. The only shape left is a `DEFERRABLE INITIALLY DEFERRED`
   *     constraint trigger, and that fires at COMMIT, which makes "insert the user, then
   *     insert the memberships" a two-statement AUTOCOMMIT sequence impossible. Every
   *     operator provisioning an account by hand through `psql`, and every test fixture
   *     that creates a member, writes it that way; a constraint that refuses the
   *     COMMIT would turn §B2's invariant into a refusal of the bootstrap path the brief
   *     asks about, and would fire again inside `authz.revoke_subject_authority`'s
   *     anonymisation and inside `0016`'s retention sweep. A `DELETE` of the last
   *     membership row is likewise uncatchable without a trigger on `user_roles`, which
   *     `0008`'s `ON DELETE CASCADE` would then fire on during every purge.
   *   * **Refuse the account and log it** is what this method used to do, and §2.3 calls
   *     silently returning a success-shaped value a bug.
   *
   * So the invariant is enforced where it CAN be enforced — at the one boundary that
   * creates accounts, atomically — and the residual is stated rather than hidden: a
   * direct `INSERT INTO users` by `app_admin` (the seed does exactly that, and always
   * writes the memberships in the same transaction) still produces a row with no
   * authority, and §B2's invariant has **no mechanical enforcement in this schema**. The
   * deferred-constraint design above is recorded here so the next person to want it
   * starts from the FK-ordering argument rather than from the idea.
   *
   * ## THE ROLE AND THE GROUP ARE NAMES, AND AN UNKNOWN ONE IS A 422
   *
   * A `uuid` would be the other wire shape and it is refused because it makes the
   * failure silent: a caller passing a role id that does not exist gets `23503` from the
   * foreign key, which names a constraint rather than a mistake. A name answers "there
   * is no role named 'boss'" — the sentence an administrator can act on. Both lookups
   * happen BEFORE the `users` INSERT, so a refusal costs no row; and both run as
   * `app_admin`, which is the only principal holding `SELECT` on `roles` (§B2 keeps the
   * permission matrix admin-only at the table level).
   *
   * ## THE MEMBERSHIP WRITES NEED A GRANT THAT ONLY A SEEDED DATABASE CARRIES
   *
   * `0001:1009-1019` withholds `INSERT` on `user_groups` from EVERY serving role,
   * `app_admin` included, because a member who can write their own membership row
   * widens their own scope in one statement. `database/seed.ts`'s `grantSeedAccess()`
   * grants it to `app_admin` as seed-time provisioning, and that grant persists — the
   * same asymmetry `0008:160-171` records about the cascade. So this route writes the
   * membership rows on any database that has been seeded, and on a MIGRATIONS-ONLY
   * database it cannot. That is stated rather than worked around, because on such a
   * database there are no `roles` and no `groups` rows either and the lookups above have
   * already answered `422` — the account could not have been completed there by any
   * means.
   *
   * `user_roles_grant_subset` (`0004`) fires on this insert and permits it: the thin
   * app's session is claimless, so `authz.actor()` is NULL, and `0004:126-133`'s second
   * branch returns NEW when `current_setting('role') = 'app_admin'` — which is what
   * `SET LOCAL ROLE app_admin` two statements above established.
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

      // Resolved BEFORE the insert, so an unknown role or group refuses without writing
      // a row and without hashing into a transaction that is about to roll back.
      const roleId = await this.resolveNamedId(
        client,
        'SELECT id FROM public.roles WHERE name = $1',
        'role',
        dto.role,
      );
      const groupId = await this.resolveNamedId(
        client,
        'SELECT id FROM public.groups WHERE name = $1',
        'group',
        dto.group,
      );

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

      // §B2's invariant, discharged. Both rows are written inside the transaction that
      // created the account, so a `201` cannot describe a half-provisioned principal —
      // and `ON CONFLICT DO NOTHING` is not used, because a conflict here would mean this
      // transaction created a SECOND membership for a user that already had one, which
      // is a different bug and should raise rather than be absorbed.
      const role = await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [created.id, roleId],
      );
      const group = await client.query(
        'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)',
        [created.id, groupId],
      );
      if (role.rowCount !== 1 || group.rowCount !== 1) {
        throw new Error(
          `provisioning ${created.username} inserted ${String(role.rowCount ?? 0)} role row(s) and ` +
            `${String(group.rowCount ?? 0)} membership row(s); §B2 requires exactly one of each and the ` +
            'account was not created',
        );
      }

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

    this.logger.log(
      `user ${created.id} (${created.username}) was created with role '${dto.role}' and group '${dto.group}', ` +
        'so it holds both axes §B2 requires and GET /users/me is readable for it immediately',
    );

    return created;
  }

  /**
   * A `name` to the `id` of the row carrying it, or a `422` naming what does not exist.
   *
   * **The statement is a literal at both call sites and is never assembled.** That is
   * the whole of the injection argument: there is no table name in a variable, no
   * `format('%I', …)`, and nothing a caller supplies reaches the SQL text — only ever a
   * parameter. It also keeps the helper honest about what it is, which is a nicer
   * shape to have than a function whose safety depends on its two call sites passing
   * something from an allow-list.
   *
   * `422` and not `404`: the request named something, and that something does not exist.
   * The same distinction `requestEmailChange` draws between `422` and `409`.
   */
  private async resolveNamedId(client: PoolClient, sql: string, label: string, name: string): Promise<string> {
    const found = await client.query<{ id: string }>(sql, [name]);
    const id: unknown = found.rows[0]?.id;
    if (typeof id !== 'string') {
      throw new UnprocessableEntityException(
        `there is no ${label} named '${name}'; an account is created with the ${label} it will hold, and ` +
          'that has to be one this installation already has',
      );
    }
    return id;
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
   * **That first sentence describes the tree as it is NOW, and it used to describe a
   * tree that did not exist.** The claim below was written when this module landed and
   * it was true then: there was no `ThrottlerModule`, no `@Throttle`, no `ThrottleSkip`,
   * and `@nestjs/throttler` was not a dependency. **All four of those are false today**
   * — the limiter was registered globally afterwards (`ThrottlerModule.forRoot` and
   * `ThrottlerGuard` as an `APP_GUARD` in `src/app.module.ts`, the policies and the
   * exported `ThrottleSkip` in `src/common/throttle.ts`) — and both routes named here
   * now carry `@Throttle({ default: THROTTLE_POLICIES.credential })` in
   * `users.controller.ts`. The reason is recorded rather than deleted, because the
   * SECOND half of it is still true and is still the reason this file writes no
   * counter of its own:
   *
   *   * The GLOBAL limiter is keyed on a source address, so it bounds VOLUME and
   *     nothing else. A per-account failure counter is a different control, and the one
   *     that answers "is somebody guessing THIS account's password".
   *   * The one real per-account mechanism is the `login_attempts` gate in
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
   *     here than the one that already has the counter. It is ALSO throttled by source
   *     address, at `THROTTLE_POLICIES.credential`.
   *   * `POST /api/users` is authenticated and administrator-only, and it **never
   *     compares a credential at all** — the password is hashed and stored. There is
   *     therefore no guessing surface to rate-limit. What it does have is a volume
   *     question ("how many accounts can an administrator create"), and that is an audit
   *     question answered by the rows themselves, not a throttle. It is ALSO throttled
   *     by source address, at `THROTTLE_POLICIES.credential`.
   *
   * The change that would close the per-account half properly, for whoever owns it: a
   * migration adding `'password_change'` to the `attempt_kind` CHECK so the failure can
   * be counted in a counter of its own without lying about what it was.
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
