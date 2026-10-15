import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { EmailService } from '../email/email.service.js';
import { ERASURE_ENV, type ErasureEnvironment } from './erasure-environment.js';
import { tombstoneAddress, tombstoneLocalPart } from './tombstone.js';

/**
 * Where the thin app's erasure connections come from.
 *
 * Structural rather than a `pg.Pool` so a transaction can be exercised without a
 * cluster — the same pairing `purge-sweeper.service.ts` uses for the sweeper, and
 * for the same reason: the machine this change was written on has no PostgreSQL,
 * and a unit suite that could only run against a server is a unit suite nobody
 * runs. `Pool` satisfies it structurally, so the production binding is the real
 * pool and not a wrapper around one.
 */
export type ErasureConnectionSource = {
  connect(): Promise<PoolClient>;
};

/** The DI token for the connection source. Bound once, in `erasure.module.ts`. */
export const ERASURE_POOL = 'ERASURE_POOL';

/**
 * The subject row, as the erasure reads it.
 *
 * Only what the erasure needs and no more. `email_anonymized` is read rather than
 * derived from `deleted_at` because it is the schema's own answer to "was this
 * email erased because somebody asked" — a row soft-deleted `inactive` still HAS
 * its email (`0009:182-187`), so `deleted_at IS NOT NULL` alone would anonymise a
 * dormant account's address.
 */
type SubjectRow = {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly deleted_at: string | Date | null;
  readonly email_anonymized: boolean;
};

/**
 * What an erasure did, or found already done.
 *
 * `tombstoneAddress` is returned on BOTH outcomes, and on the second it is the
 * same string as on the first: that equality is the idempotency claim, made as a
 * value a caller can compare rather than as a comment.
 */
export type ErasureOutcome = {
  readonly userId: string;
  /** True when the subject was already anonymised and this call changed nothing. */
  readonly alreadyErased: boolean;
  readonly tombstoneAddress: string;
  readonly anonymizedAt: string | Date | null;
  readonly pepperKid: string;
};

/**
 * The read. One row, no predicate beyond the id, because the id IS the identity
 * and the read runs as the superset principal.
 *
 * **The superset principal is a fact about the transaction, not about the
 * connection.** `0008:441-455` withholds `SELECT` on `users` from every serving
 * role except `app_admin`, and `0008:455` grants it to `app_admin` — so a bare
 * `SELECT` on a pooled `pgrst_authenticator` connection is refused with
 * `permission denied for table users`, which is the grant boundary working
 * exactly as documented and not a misconfiguration. Every other writer here runs
 * `BEGIN` then `SET LOCAL ROLE app_admin` (`auth.service.ts:140`,
 * `email-audit.writer.ts:143`, `purge-sweeper.service.ts:303`), and the read is
 * no exception: `SET LOCAL` is transactional, so it needs a block to live in.
 */
export const SELECT_SUBJECT_SQL = `
SELECT id, username, email, deleted_at, email_anonymized
  FROM users
 WHERE id = $1
`;

/**
 * The anonymisation, and the idempotency is IN THE WHERE CLAUSE.
 *
 * `AND deleted_at IS NULL` is the whole of it: a second run matches zero rows and
 * therefore cannot write a second timestamp, cannot rewrite the address a second
 * time and cannot re-enter the tombstone. There is no "have I already done this"
 * branch to get wrong, and no window between the check and the write — which a
 * read-then-write would have, and which two concurrent erasures would both walk
 * through.
 *
 * `email_anonymized` is NOT named: it is `GENERATED ALWAYS AS (deletion_reason =
 * 'rtbf') STORED` and naming it raises `cannot update a generated column`. It is
 * derived from the reason set here, so the two columns cannot disagree because only
 * one of them exists.
 *
 * `SET deleted_at = now()` rather than a parameter: the instant of erasure is a
 * fact about the database, and passing one in would let a caller claim an erasure
 * happened at a time of their choosing.
 */
export const ANONYMISE_SUBJECT_SQL = `
UPDATE users
   SET email           = $2,
       username        = $3,
       password_hash   = $4,
       deleted_at      = now(),
       deletion_reason = 'rtbf'
 WHERE id = $1
   AND deleted_at IS NULL
RETURNING deleted_at
`;

/**
 * The login telemetry keeps its forensic fields and loses the name.
 *
 * `ip`, `ip_normalized`, `ip_subnet`, `status` and `created_at` stay exactly as
 * they are — 11 CCR §7111 requires retaining the data needed to investigate a
 * security incident, and a row with no username and no source address investigates
 * nothing. Only `username` is rewritten, and it is rewritten to the SAME tombstone
 * marker the account itself carries, so a reader can still tell that these two rows
 * belonged to one erased subject.
 *
 * **By username, because there is nothing else.** `login_attempts` carries no
 * `user_id` and no foreign key to `users` (`0002:86-101`), which is why it is in the
 * UNSCOPED category rather than DERIVED. So this statement is keyed on the old
 * username, read from the subject row in the same transaction — which is why the
 * read must precede the anonymisation, and why a second run (which takes the
 * `deleted_at IS NULL` branch and returns before this statement is ever issued)
 * cannot rewrite an address that has already been neutralised.
 */
export const ANONYMISE_LOGIN_ATTEMPTS_SQL = `
UPDATE login_attempts
   SET username = $2
 WHERE username = $1
`;

/**
 * The subject's sessions die with the identity.
 *
 * `0009:346-351` records this as the migration's own residual — the anonymisation
 * columns revoke *authority*, and nothing revokes the refresh tokens that would let
 * a live token mint another one. `AuthService` holds UPDATE on `refresh_tokens` as
 * `app_admin` for exactly this kind of write, so the erasure closes the residual
 * from the application side rather than leaving it documented.
 *
 * The predicate is the same shape as the user's: a token already revoked is left
 * alone, so a re-run is a no-op here too.
 */
export const REVOKE_SESSIONS_SQL = `
UPDATE refresh_tokens
   SET revoked_at = now()
 WHERE user_id = $1
   AND revoked_at IS NULL
`;

/**
 * The subject's open requests are answered by answering them.
 *
 * `app_admin` is the superset principal, so `privacy_request_update`'s
 * `WITH CHECK` admits this; a member could take their own row to `withdrawn` and
 * nothing further, which is the split `0010:547-566` draws.
 *
 * ## THIS STATEMENT MATCHES ZERO ROWS TODAY, AND THAT IS A SCHEMA GAP — MEASURED
 *
 * Not a guess, and not a fault in the statement. **On PostgreSQL 18 an `UPDATE`
 * whose `WHERE` names columns of the target relation has the table's `SELECT`
 * policy ANDed into the scan filter as well as its `UPDATE` policy.** Reproduced
 * verbatim against this database, `EXPLAIN (ANALYZE)` of this statement as a
 * claimless `app_admin` session, against a row that exists:
 *
 * ```text
 * Index Cond: (privacy_requests.user_id = '01a14124-…'::uuid)
 *   Filter: ((privacy_requests.status = ANY ('{open,in_progress}'::text[]))
 *            AND ((CURRENT_USER = 'app_admin'::name)
 *                 OR ((privacy_requests.user_id = authz.actor()) AND authz.can_update_privacy_request()))
 *            AND (ANY (privacy_requests.user_id = (hashed SubPlan 2).col1)))
 *   One-Time Filter: authz.can_read_privacy_request()
 *   Rows Removed by Filter: 1
 *  Update on public.privacy_requests  (actual rows=0.00 loops=1)
 * ```
 *
 * The third conjunct is `privacy_request_read` (`0010:531-548`), and it has **no
 * `current_user = 'app_admin'` branch** — its only path is
 * `authz.can_read_privacy_request()`, i.e. `has_permission(authz.actor(), …)`, and
 * `authz.actor()` reads the `request.jwt.claims` GUC that the thin app has no
 * legitimate way to set (§B2 F1, enforced by
 * `test/unit/claims-write-surface.spec.ts`). With no actor the filter is
 * unsatisfiable and the UPDATE matches nothing — `Rows Removed by Filter: 1`, and
 * **`UPDATE 0`, with no error anywhere.** Every other statement here is unaffected,
 * because every other table's read policy opens with an admin branch
 * (`users_read_scope`, `0008:399`) or is a single `FOR ALL` policy
 * (`refresh_tokens`, `login_attempts`, `0002`).
 *
 * **So a data-subject's request stays `open` after their account is erased.** The
 * consequence is asserted as a live value, not described:
 * `test/rls/privacy-requests.spec.ts`, "a claimless app_admin session reads ZERO
 * requests and closes none", files a request and then reads its `status` back
 * through the superuser — `open`, unchanged, no error.
 *
 * ## THE THREE CANDIDATE FIXES, EACH BUILT AND MEASURED, AND WHY NONE IS TAKEN
 *
 * The obvious fix is a `SECURITY DEFINER authz.close_subject_privacy_requests(uuid)`
 * mirroring `authz.revoke_subject_authority()` (`0009`) — a narrow privileged seam
 * that widens no read path. **It was built, and it updates zero rows.** Inside a
 * `SECURITY DEFINER` body `current_user` rebinds to the OWNER (`0014:43-50`
 * measures it), and `privacy_requests` is `FORCE ROW LEVEL SECURITY` (`0010:445`),
 * so the owner is bound by `privacy_request_read` exactly as any caller is. That is
 * a fourth "denies everyone silently", and it is worse than the first because the
 * seam looks like the fix.
 *
 * `SET LOCAL row_security = off` inside that function does not rescue it: on a
 * FORCEd table it raises `query would be affected by row-level security policy for
 * table "users"` rather than bypassing anything, so the escape hatch is not even
 * open. (It is also the owner bypass `0009` refused to take, so reaching for it
 * would reopen a decision already made.)
 *
 * The two candidates that DO work, each measured on this database:
 *
 * | Change | Measured | Cost |
 * |---|---|---|
 * | `current_user = 'app_admin'` OR'd into `privacy_request_read` | claimless admin reads **7 of 7** requests across groups; `UPDATE 1` | a `role: app_admin` PostgREST token gains the complete DSAR workload of the deployment. **Refused**, and the refusal is why the wide fix is named here at all. |
 * | `ALTER TABLE privacy_requests NO FORCE ROW LEVEL SECURITY` | the narrow seam updates **1** row; a claimless owner session reads **1** row where FORCE gives **0** | the migration role gains unrestricted read and write of every request on the table — the most sensitive personal data in the schema, belonging to exactly the people who asked to be forgotten. Pinned as `forcerowsecurity = true` by `privacy-requests.spec.ts` with that reasoning attached. |
 *
 * Note the table, because it is the part that is easy to get wrong: the wide fix
 * works for a claimless `app_admin` session and does **not** work for a
 * `SECURITY DEFINER` seam (its `current_user` is the owner, so the new branch does
 * not match either) — measured, 0 rows. The narrow fix works for the seam and does
 * **not** work for the shipped statement (the read policy still demands an actor) —
 * measured, `UPDATE 0`. They are different changes, and neither alone does both.
 *
 * **Every one of these is a decision about what the migration role and the admin
 * principal may reach, which is why none of them is taken here.** What is missing
 * underneath all of them is one thing: a database-visible identity for a thin-app
 * write. The thin app authenticates with `JwtAuthGuard` and never sets the claims
 * GUC, so the database cannot tell "the erasure of the caller" from "any other
 * `app_admin` write" — which is the same gap the service comment on
 * `eraseSelf` names, and the decision it needs belongs to whoever owns the
 * authorization model, not to this feature. The statement stays because it is the
 * correct operation; deleting it would be a smaller change and a false one.
 *
 * ## THE STATUTORY RECORD IS UNREACHABLE, SEPARATELY
 *
 * `privacy_request_audits` is the compliance record, and no serving role can
 * write it: its only writer is `authz.append_privacy_request_audit()`, which
 * requires `authz.actor()`.
 *
 * **The write itself is NOT the obstacle — measured.** `privacy_request_audits` is
 * `ENABLE`d and deliberately NOT `FORCE`d precisely so its `SECURITY DEFINER`
 * writer runs as the owner (`0010:449-462`), and a seam built on that precedent
 * inserts a row without complaint. Two things stop it, and both are the same
 * missing identity:
 *
 *  1. **The gate has nothing to check against.** Any seam that admits a claimless
 *     `app_admin` session can also be handed a colleague's subject id, and
 *     `0010:552-556` names exactly that as the harm to avoid: a caller who can
 *     certify that a statutory obligation was discharged is manufacturing a
 *     compliance claim. `0014` closed the same hole in the existing writer, and
 *     re-opening it through a second entry point is how that fix gets undone by
 *     accident.
 *  2. **`subject_hmac` cannot be computed in the database.** It is
 *     `HMAC(PRIVACY_HMAC_PEPPER, …)`, the pepper is a required environment secret
 *     read by `ERASURE_ENV` (`erasure-environment.ts:117`) and is deliberately
 *     never sent to PostgreSQL, and `privacy_request_audits.pepper_kid` is
 *     `text NOT NULL` with no default. So the record cannot be written by a
 *     trigger on `users` — the shape `0009`'s choke point uses — because the one
 *     column a database-side writer cannot supply is the one that links the record
 *     to a subject the row outlives.
 *
 * So the working copy is not closed and the compliance row is not written, and both
 * are reported rather than fabricated.
 */
export const CLOSE_OPEN_REQUESTS_SQL = `
UPDATE privacy_requests
   SET status = 'fulfilled',
       closed_at = now()
 WHERE user_id = $1
   AND status IN ('open', 'in_progress')
`;

/** bcrypt cost, matched to the cost `AuthService` hashes at. A change here is a change to login timing too. */
const BCRYPT_COST = 12;

/**
 * Erasure: soft delete plus anonymisation, immediately on confirmation.
 *
 * ## WHY A SERVICE AND NOT AN `authz` FUNCTION OR AN RPC
 *
 * The three candidates, and what each one is actually good for:
 *
 *  - **An `authz` `SECURITY DEFINER` function.** This is the right shape for the
 *    machine writes (`authz.claim_due_purge()`, `authz.complete_purge()`,
 *    `authz.enqueue_inactive_purges()`): a narrow statement that has to run with
 *    the owner's privileges because no request-serving role may. Erasure is not
 *    that. It spans four tables, it needs a key that must never reach the
 *    database at all, and it has to be ordered against an outbound SMTP call —
 *    none of which a `SECURITY DEFINER` body can express, and all of which would
 *    become a function with a secret in its argument list.
 *  - **A PostgREST RPC.** Not available here and not wanted. `postgrest.conf` sets
 *    `db-schemas = "public"`, so an `authz` function is not HTTP-addressable at
 *    all; putting the operation in `public` instead would make it callable by any
 *    PostgREST client holding any token, with no route-level authentication, no
 *    receipt ordering and no throttling — an erasure endpoint with the guardrails
 *    removed, reachable through the API layer's own key.
 *  - **This service**, through the escalation boundary every other writer uses
 *    (`pgrst_authenticator` + `SET LOCAL ROLE app_admin`, one transaction).
 *    `0008:457-464` already says erasure is a thin-app operation and deliberately
 *    withholds UPDATE on `users` from `app_member`.
 *
 * ## WHAT STOPS A USER ERASING SOMEBODY ELSE
 *
 * **There is no subject parameter.** `eraseSelf(subjectId)` is the whole surface,
 * and the id it takes is the one `JwtAuthGuard` read out of the verified token's
 * `sub` claim. No DTO carries a `user_id`, so "erase user B" is not a request this
 * feature can express — it is unrepresentable rather than merely checked.
 *
 * That is an APPLICATION control, and saying so matters: `users_update` is
 * `USING (current_user = 'app_admin')` (`0008:421`), so once the thin app is
 * running as the superset principal the database cannot tell an erasure from any
 * other write, and the row-level layer genuinely does NOT stop a cross-subject
 * erasure here. The database-enforced half that does exist is the subject gate in
 * `authz.append_privacy_request_audit()` (`0014:183-194`), which refuses a
 * `p_subject_user_id` that is not the caller for anyone but an operator.
 *
 * ## WHY A `SECURITY DEFINER authz.anonymise_subject(uuid)` CANNOT SUPPLY THE MISSING HALF
 *
 * It was built, and it was measured as updating **zero rows with no error** —
 * before: `deleted_at=NULL reason=NULL`; after: `deleted_at=NULL reason=NULL`.
 * The owner is `app` (`NOSUPERUSER NOBYPASSRLS`, asserted from `pg_roles`), `users`
 * is FORCE ROW LEVEL SECURITY (`0008:326`), and inside a `SECURITY DEFINER` body
 * `current_user` rebinds to the owner, so `users_update`'s `current_user =
 * 'app_admin'` matches nothing. `SET LOCAL row_security = off` inside it does not
 * rescue it either: on a FORCEd table that raises `query would be affected by
 * row-level security policy` instead of bypassing anything. Both halves of the
 * escape route are closed by `0008`/`0009` on purpose.
 *
 * That leaves the obvious question, and its answer is why this is escalated rather
 * than fixed. A self-check below the application needs to know who the caller is,
 * and in this session there is no one to ask:
 *
 * - **`authz.actor()` is NULL.** Measured, and it is the only identity source the
 *   policies have. A gate shaped like `0014`'s — *is this caller the subject?* —
 *   therefore answers `false` for **every** erasure, a fifth "denies everyone
 *   silently". Measured.
 * - **The one setting that would fill it is the one §B2 F1 forbids.**
 *   `request.jwt.claims` is a custom GUC any role may `SET`, and it was measured
 *   being set from inside an `app_admin` session, after which the same gate
 *   answers `PERMITTED` for a subject the session merely named. A self-check
 *   resting on it is self-certified: the caller writes both the answer and the
 *   question. `test/unit/claims-write-surface.spec.ts` fails the build if `src/`
 *   writes that setting, and that rule is right for the reason this paragraph
 *   gives.
 * - **The alternative is a channel nobody has built**, and the two obvious ones
 *   are both worse than the gap. A dedicated database role that only an erasure
 *   session may `SET ROLE` into is a new cluster-scoped role plus an
 *   `ADMIN OPTION` grant in `database/bootstrap/001_roles.sql` (§B1: role
 *   creation is deliberately not a migration), and it does not solve this either —
 *   `users_update` would need a branch for it, which is the same policy change
 *   under a new name. Moving the identity into the thin app's `pg` layer is the
 *   claims GUC again.
 *
 * **So the decision needed is not "which migration": it is "how does the database
 * learn the identity of a thin-app write at all", and every answer to that is a
 * change to the authorization model itself rather than to the erasure.** That
 * belongs to whoever owns that model. It is reported here and not decided here.
 *
 * ## THE RECEIPT IS SENT FIRST, AND A FAILED RECEIPT ABORTS THE ERASURE
 *
 * Once the address is a tombstone there is nowhere to send it, and "we emailed
 * your receipt to `deleted-<hmac>@…`" is the exact failure this ordering exists to
 * prevent. So the send happens **outside and before** the transaction, awaited, and
 * a transport refusal propagates: the account is NOT anonymised, and the caller is
 * told the erasure did not happen. That is fail-closed and it is recoverable —
 * the alternative, anonymising first and discovering the bounce afterwards, leaves a
 * person erased with no proof they were ever told.
 *
 * ## WHY THE PASSWORD HASH IS REPLACED RATHER THAN NULLED
 *
 * `users.password_hash` is `NOT NULL` (`0002:32`) and making it nullable is a
 * migration, which is out of scope — but leaving the old hash is the failure the
 * decision list names: a tombstone that still verifies an old password is not an
 * erasure. So the column is overwritten with a bcrypt hash of a 32-byte secret
 * minted by the CSPRNG at erasure time and **stored nowhere**. It is not a usable
 * credential for four independent reasons: the plaintext is gone, so no login can
 * reproduce it; the username it would be paired with no longer exists; the rows it
 * could authenticate are revoked in the same transaction; and the row's own scope
 * and capability were dropped by `authz.revoke_subject_authority()` (`0009`) the
 * moment `deleted_at` moved. It is a real bcrypt hash at the real cost, so the
 * login path's `bcrypt.compare` still burns the same time it always did and the
 * substitution leaks nothing about what the old password was.
 */
@Injectable()
export class ErasureService {
  private readonly logger = new Logger(ErasureService.name);

  constructor(
    @Inject(ERASURE_ENV) private readonly env: ErasureEnvironment,
    @Inject(ERASURE_POOL) private readonly pool: ErasureConnectionSource,
    private readonly email: EmailService,
  ) {}

  /**
   * Erase the caller's own account. `subjectId` is the verified `sub` and nothing
   * else ever reaches it.
   *
   * @throws EmailDeliveryError when the receipt could not be delivered, BEFORE any
   *   write has happened. The account is left untouched in that case.
   * @throws NotFoundException when no row carries that id.
   */
  async eraseSelf(subjectId: string): Promise<ErasureOutcome> {
    const subject = await this.readSubject(subjectId);

    if (subject === undefined) {
      // A token whose user row is gone is a real state — the retention purge
      // removed it — and it is reported rather than reported as a success.
      throw new NotFoundException('no account is associated with this session');
    }

    const tombstone = tombstoneAddress(subject.id, this.env.pepper, this.env.tombstoneDomain);

    // IDEMPOTENCY, FIRST BRANCH. `email_anonymized` is true exactly when the reason
    // is 'rtbf' (`0009:188-190`), so this is the schema's own answer rather than a
    // re-derivation — and it is the right test even where `deleted_at` alone would
    // do, because a row soft-deleted `inactive` is retained and still has its mail.
    if (subject.email_anonymized) {
      this.logger.log(
        `erasure no-op for ${subject.id}: already anonymised under pepper kid ${this.env.pepperKid}`,
      );
      return {
        userId: subject.id,
        alreadyErased: true,
        tombstoneAddress: tombstone,
        anonymizedAt: subject.deleted_at,
        pepperKid: this.env.pepperKid,
      };
    }

    // FIRST, AND AWAITED. Outside the transaction, so a refusal costs no lock and
    // leaves no partial state, and awaited, so the write below cannot begin until
    // the message is gone. A throw here aborts the whole erasure.
    await this.email.sendErasureReceipt(subject.email, subject.id);

    const neutralUsername = tombstoneLocalPart(subject.id, this.env.pepper);
    const deletedAt = await this.applyErasure(subject, neutralUsername, tombstone);

    this.logger.log(
      `erasure applied for ${subject.id} under pepper kid ${this.env.pepperKid}: ` +
        `email and username rewritten, sessions revoked, login telemetry anonymised`,
    );
    return {
      userId: subject.id,
      alreadyErased: false,
      tombstoneAddress: tombstone,
      anonymizedAt: deletedAt,
      pepperKid: this.env.pepperKid,
    };
  }

  /**
   * The read, in its own transaction, through the same escalation boundary as
   * the write.
   *
   * **Why this opens a transaction at all.** `SET LOCAL` is transactional: outside
   * a block it warns and does nothing, so "just set the role for the read" is not
   * available. `SET ROLE` for the session is available and is NOT used — a role
   * left set on a connection returned to the pool hands the next borrower an
   * admin session, which is a privilege leak into a resource nobody reasons about.
   *
   * **Why it is a separate transaction from the write.** The receipt crosses the
   * network between them, and a transaction held open across an SMTP round trip is
   * an idle-in-transaction session holding a snapshot for as long as the relay
   * takes. The read therefore commits and the connection goes back before the send,
   * so the send holds no lock, no snapshot and no connection — which is the
   * property `test/unit/privacy/erasure.spec.ts` asserts.
   *
   * It is two transactions, not one, and both are `SET LOCAL ROLE app_admin`
   * rather than a role baked into the pool: the escalation is visible at the two
   * places it happens instead of being an ambient property of a connection
   * factory, which is what lets a reader check it.
   */
  private async readSubject(subjectId: string): Promise<SubjectRow | undefined> {
    const client: PoolClient = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const result = await client.query<SubjectRow>(SELECT_SUBJECT_SQL, [subjectId]);

      await client.query('COMMIT');
      committed = true;
      return result.rows[0];
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The whole write, in ONE transaction.
   *
   * One statement each, in the order that matters: the anonymisation runs FIRST so
   * that a failure in any later statement leaves the row visibly un-anonymised
   * rather than half-rewritten, and so that `0009`'s BEFORE trigger has fired by the
   * time the sessions are revoked.
   *
   * `password_hash` is computed BEFORE the transaction opens rather than inside it:
   * bcrypt at cost 12 is hundreds of milliseconds of deliberate CPU, and holding a
   * row lock across it would be a self-inflicted denial of service on one account.
   * Computing it first cannot leak a partial write — a value that is never used is
   * simply never used.
   */
  private async applyErasure(
    subject: SubjectRow,
    neutralUsername: string,
    tombstone: string,
  ): Promise<string | Date | null> {
    // Never recoverable: 32 CSPRNG bytes whose plaintext exists only in this
    // frame, and which nothing stores.
    const unusablePassword = await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_COST);

    const client: PoolClient = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const anonymised = await client.query<{ deleted_at: string | Date }>(ANONYMISE_SUBJECT_SQL, [
        subject.id,
        tombstone,
        neutralUsername,
        unusablePassword,
      ]);

      // The idempotency guard, asserted rather than assumed. `deleted_at IS NULL`
      // made the second run match zero rows; if a concurrent erasure won the race
      // between the read above and this statement, the honest answer is "already
      // done", and rolling back is what makes the second caller's transaction leave
      // the first one's tombstone exactly as it found it.
      if (anonymised.rowCount !== 1) {
        await client.query('ROLLBACK');
        committed = true;
        this.logger.log(
          `erasure for ${subject.id} matched no live row: a concurrent erasure completed first, so this one is rolled back as a no-op`,
        );
        return null;
      }

      await client.query(ANONYMISE_LOGIN_ATTEMPTS_SQL, [subject.username, neutralUsername]);
      await client.query(REVOKE_SESSIONS_SQL, [subject.id]);
      await client.query(CLOSE_OPEN_REQUESTS_SQL, [subject.id]);

      await client.query('COMMIT');
      committed = true;
      return anonymised.rows[0]?.deleted_at ?? null;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}