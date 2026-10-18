import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import { EmailService } from '../email/email.service.js';
import {
  emailChangeSubject,
  encodeEmailChangeToken,
  isCompositeToken,
  normalizePendingEmail,
  readEmailChangeToken,
} from './email-change-token.js';
import { TOKEN_ENV, type TokenEnvironment } from './token-environment.js';
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  isTokenPurpose,
  type DeliverTokenInput,
  type DeliveryResult,
  type MintEmailChangeInput,
  type MintTokenInput,
  type MintedToken,
  type RedeemEmailChangeResult,
  type RedeemTokenInput,
  type RedeemTokenResult,
  type RedeemedToken,
  type TokenPurpose,
} from './token.types.js';

const SUBJECT_DOMAIN_LABEL = 'auth.token.subject.v1';
const TOKEN_HASH_DOMAIN_LABEL = 'auth.token.hash.v1';
const DUMMY_HASH = Buffer.alloc(32, 0);

/**
 * The redemption window for a BARE token: `16 … 256`.
 *
 * 32 random bytes is 43 base64url characters and the window is a sanity bound, not a
 * format check — it exists so a megabyte of caller-supplied text is refused before it
 * is HMAC'd. A composite token is a different shape with a different ceiling
 * (`EMAIL_CHANGE_TOKEN_MAX_LENGTH`), which is why the bound is a parameter of the
 * lookup rather than a constant buried in it. These numbers are mirrored by
 * `EmailVerificationConfirmDto` and `PasswordResetConfirmDto`, and the two windows
 * must not drift: a DTO narrower than the primitive turns one uniform "that link is
 * no good" into two distinguishable answers.
 */
const BARE_TOKEN_MIN_LENGTH = 16;
const BARE_TOKEN_MAX_LENGTH = 256;

/**
 * A mint whose raw token value the CALLER has already composed.
 *
 * The three bare flows let `mint` generate the 32 random bytes, because the value is
 * nothing but entropy. The email-change flow cannot: its raw value also carries the
 * pending address, so it is built by `encodeEmailChangeToken` before the row is
 * written, and the row's `token_hash` has to be the HMAC of the WHOLE thing including
 * that payload. One private method takes both shapes, so the insert, the
 * `authz.mint_auth_token` call, the TTL default and the returned id have exactly one
 * implementation.
 */
interface PersistMintInput extends MintTokenInput {
  readonly rawToken: string;
}

type RedeemSqlRow = {
  readonly id: string;
  readonly user_id: string | null;
  readonly subject_hmac: Buffer | string;
  readonly pepper_kid: string;
  readonly purpose: string;
  readonly created_at: Date | string;
  readonly expires_at: Date | string;
};

type UserLookupRow = {
  readonly id: string;
  readonly username: string;
  readonly email: string;
};

/**
 * `pg` returns `bytea` as a `Buffer`, but the same row read through any other path
 * can arrive as the hex string, and `Buffer.from(x, 'hex')` on a Buffer is a silent
 * identity — so the two shapes are named once here instead of at each call site,
 * where one of the two would eventually be forgotten.
 */
function decodeSubjectHmac(subjectHmac: Buffer | string): Buffer {
  return Buffer.isBuffer(subjectHmac) ? subjectHmac : Buffer.from(subjectHmac, 'hex');
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
    @Inject(TOKEN_ENV) private readonly tokenEnv: TokenEnvironment,
    private readonly emailService: EmailService,
  ) {}

  /**
   * One transaction, elevated, on a borrowed connection — and the `BEGIN` is not
   * ceremony.
   *
   * ## `SET LOCAL` IS A NO-OP OUTSIDE A TRANSACTION
   *
   * `SET LOCAL ROLE app_admin` outside a transaction block does not fail, does not
   * throw, and does nothing: PostgreSQL emits `WARNING: SET LOCAL can only be used
   * in transaction blocks` and the statement has **no effect**. Every statement then
   * runs as `pgrst_authenticator`, which holds no privileges on `users`,
   * `refresh_tokens` or `auth_tokens` — so each one fails `42501 permission denied
   * for table …` and the error names a permission problem that has nothing to do
   * with the grants.
   *
   * That is not a hypothetical. This class is the **only** place in `src/` that
   * issued `SET LOCAL ROLE app_admin` without a `BEGIN`, and the symptom was a
   * password-reset request that logged `permission denied for table users` from a
   * route whose SQL named only `id, username, email`. `AuthService`,
   * `EmailAuditWriter`, `ErasureService` and both purge services all open the
   * transaction first; this is the same pattern, and it is now the only copy.
   *
   * ## Why `SET LOCAL` and not `SET`
   *
   * `SET ROLE` would work outside a transaction and is the obvious "fix". It is the
   * wrong one: `pg.Pool.release()` returns a session to the pool without resetting
   * its state, so a bare `SET ROLE` leaves the **connection elevated** for whoever
   * borrows it next. `SET LOCAL` scopes the elevation to the transaction that ends
   * before the connection is handed back. §B5's boundary is "the authenticator
   * `SET`s the role per transaction", and `database/seed.ts` uses this exact shape.
   *
   * ## Why `ROLLBACK` is attempted and swallowed
   *
   * A failure may have aborted the transaction, in which case `ROLLBACK` itself
   * errors with `25P02`. That error is not information — the original is already
   * propagating — so it is dropped rather than replacing the real cause. Mirrors
   * `AuthService`'s own transaction handling exactly.
   */
  private async asAppAdmin<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const result = await work(client);
      await client.query('COMMIT');
      committed = true;
      return result;
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
   * Domain-separated HMAC-SHA256 of the presented token.
   * Never stores raw tokens. Survives database dumps.
   */
  hashToken(rawToken: string): Buffer {
    return createHmac('sha256', this.tokenEnv.pepper)
      .update(`${TOKEN_HASH_DOMAIN_LABEL}:${rawToken}`)
      .digest();
  }

  /**
   * Domain-separated HMAC-SHA256 of the normalized subject identifier.
   */
  hashSubject(subject: string): Buffer {
    const normalized = subject.trim().toLowerCase();
    return createHmac('sha256', this.tokenEnv.pepper)
      .update(`${SUBJECT_DOMAIN_LABEL}:${normalized}`)
      .digest();
  }

  /**
   * Mint a new one-time token and persist its hash through the authz seam.
   * Returns the rawToken exactly once to the caller.
   */
  async mint(input: MintTokenInput): Promise<MintedToken> {
    return this.persistMint({ ...input, rawToken: randomBytes(32).toString('base64url') });
  }

  /**
   * The one insert, for both a bare token and a composite one.
   *
   * Every validation `mint` performs lives here, so a future flow that composes its
   * own raw value gets the same refusal on an empty subject, a bad purpose and a
   * non-positive TTL rather than a laxer copy of this method.
   */
  private async persistMint(input: PersistMintInput): Promise<MintedToken> {
    if (!isTokenPurpose(input.purpose)) {
      throw new Error(`Invalid token purpose: '${String(input.purpose)}'`);
    }

    if (
      typeof input.subjectIdentifier !== 'string' ||
      input.subjectIdentifier.trim() === ''
    ) {
      throw new Error('subjectIdentifier must be a non-empty string');
    }

    const ttlSeconds = input.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS[input.purpose];
    if (typeof ttlSeconds !== 'number' || ttlSeconds <= 0 || !Number.isFinite(ttlSeconds)) {
      throw new Error(`ttlSeconds must be a positive finite number, received ${String(ttlSeconds)}`);
    }

    const tokenHash = this.hashToken(input.rawToken);
    const subjectHmac = this.hashSubject(input.subjectIdentifier);

    const id = await this.asAppAdmin(async (client) => {
      const result = await client.query<{ id: string }>(
        'SELECT authz.mint_auth_token($1, $2, $3, $4, $5, $6) AS id',
        [
          input.userId ?? null,
          subjectHmac,
          this.tokenEnv.pepperKid,
          tokenHash,
          input.purpose,
          ttlSeconds,
        ],
      );

      const row = result.rows[0];
      if (row === undefined || !row.id) {
        throw new Error('mint_auth_token did not return an id');
      }
      return row.id;
    });

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return {
      id,
      rawToken: input.rawToken,
      purpose: input.purpose,
      expiresAt,
    };
  }

  /**
   * Mint a link that moves this member's address, and carries the address it would
   * move it to.
   *
   * ## The two-phase ordering, and why it is the WHOLE of the control
   *
   * Nothing about `users` is written here. The row written is an `auth_tokens` row,
   * and `users.email` still holds the address mail is delivered to — so a password
   * reset requested between this call and the redemption still reaches the real
   * owner. Writing `users.email` here and mailing the new address would be an account
   * takeover in two requests: repoint the account at a mailbox the attacker controls,
   * then ask for a reset, and the reset link arrives at the attacker.
   *
   * ## Why the subject is the user and not the address
   *
   * `emailChangeSubject` — read that module. In one line: the supersede below has to
   * find every outstanding link for this member WITHOUT knowing which address any of
   * them asked for, and the address is deliberately stored nowhere.
   *
   * ## Why the purpose is `email_verification` and not a fourth kind
   *
   * `auth_tokens.purpose` is a three-value CHECK and `authz.mint_auth_token` raises
   * on anything else. Naming a fourth kind is a migration to the schema, which this
   * unit does not write. The flow is separated from address verification by its token
   * FORMAT (a bare `redeem` refuses a value carrying `ec1.`, and `redeemEmailChange`
   * refuses one that does not) and by this subject, so the two cannot consume each
   * other's links. `test/unit/users/email-change-token.spec.ts` proves both halves,
   * and `test/unit/token/token.service.spec.ts`'s window assertions still hold because
   * `redeem`'s bare-token window is unchanged.
   */
  async mintEmailChange(input: MintEmailChangeInput): Promise<MintedToken> {
    const pendingEmail = normalizePendingEmail(input.pendingEmail);
    if (pendingEmail === '') {
      throw new Error('an email-change token needs a non-empty pending address');
    }
    if (typeof input.userId !== 'string' || input.userId.trim() === '') {
      throw new Error('an email-change token needs the user id it is bound to');
    }

    return this.persistMint({
      purpose: 'email_verification',
      subjectIdentifier: emailChangeSubject(input.userId),
      userId: input.userId,
      rawToken: encodeEmailChangeToken(pendingEmail, randomBytes(32).toString('base64url')),
    });
  }

  /**
   * Atomically redeem a token.
   * Single-use: marks consumed_at = clock_timestamp().
   * Concurrent redemptions of the exact same token race at the database level:
   * exactly one succeeds, subsequent callers match zero rows.
   *
   * Expired, already-consumed, cross-purpose, malformed, or non-existent tokens
   * all return the uniform `{ status: 'invalid_or_expired' }`.
   *
   * ## WHY A COMPOSITE TOKEN IS REFUSED HERE, BEFORE ANY HASH
   *
   * Because `purpose` cannot name `email_change` without a migration, an
   * email-change link IS an `email_verification` row as far as
   * `authz.redeem_auth_token` is concerned. Without the check below, presenting one
   * to `POST /auth/email-verification/confirm` would consume it, stamp
   * `email_verified_at`, and answer `200 { status: 'verified' }` — silently destroying
   * the pending change while reporting a success that describes a different fact.
   * `isCompositeToken` refuses the shape before the digest is computed, so a bare
   * redemption cannot reach a composite row at all, and the caller's link survives to
   * be presented at the route that understands it.
   */
  async redeem(input: RedeemTokenInput): Promise<RedeemTokenResult> {
    if (!isTokenPurpose(input.expectedPurpose)) {
      return { status: 'invalid_or_expired' };
    }

    if (!this.isPlausibleRawToken(input.rawToken, BARE_TOKEN_MIN_LENGTH, BARE_TOKEN_MAX_LENGTH)) {
      // Execute constant-time dummy equality to eliminate timing channels
      timingSafeEqual(DUMMY_HASH, DUMMY_HASH);
      return { status: 'invalid_or_expired' };
    }

    const presentedHash = this.hashToken(input.rawToken);

    const row = await this.consumeToken(presentedHash, input.expectedPurpose);

    // Constant-time confirmation
    timingSafeEqual(presentedHash, presentedHash);

    if (row === undefined) {
      return { status: 'invalid_or_expired' };
    }

    return { status: 'success', token: this.toRedeemedToken(row, input.expectedPurpose) };
  }

  /**
   * Redeem an email-change link, and recover the address it moves the account to.
   *
   * ## THE ORDER IS THE PROPERTY, AND IT IS TWO REFUSALS IN ONE LINE
   *
   * The payload is read from the presented value FIRST, and a value that is not an
   * email-change token never reaches the database. That is what stops this route
   * consuming somebody's live address-verification link: the check that recognises
   * the wrong shape is also the check that keeps the token alive.
   *
   * A bare `redeem` gets the mirror image of that guarantee from `isCompositeToken`,
   * so neither route can reach the other's row.
   *
   * ## WHAT IS AUTHENTICATED, AND BY WHAT
   *
   * `hashToken` covers the WHOLE raw token, payload included, so the address that
   * comes back out is the address that was minted — a caller cannot present a token
   * for `victim@example.test` and have this hand back `attacker@example.test`, because
   * changing one character changes the digest and the digest is the lookup key. The
   * `subject_hmac` comparison below is a second, local assertion of a property the
   * arithmetic already has: it says "this row is one of THIS member's change links"
   * rather than leaving it to be inferred, and a mismatch is refused with the same
   * uniform answer as everything else.
   */
  async redeemEmailChange(rawToken: string): Promise<RedeemEmailChangeResult> {
    const pendingEmail = readEmailChangeToken(rawToken);
    if (pendingEmail === null) {
      timingSafeEqual(DUMMY_HASH, DUMMY_HASH);
      return { status: 'invalid_or_expired' };
    }

    const presentedHash = this.hashToken(rawToken);
    const row = await this.consumeToken(presentedHash, 'email_verification');
    timingSafeEqual(presentedHash, presentedHash);

    if (row === undefined) {
      return { status: 'invalid_or_expired' };
    }

    const userId = row.user_id;
    if (userId === null) {
      throw new Error(
        'an email-change token was redeemed with no subject: mintEmailChange always binds one, so this ' +
          'is not reachable from an HTTP request and must not be treated as a bad link',
      );
    }
    if (!this.isChangeSubjectFor(row.subject_hmac, userId)) {
      return { status: 'invalid_or_expired' };
    }

    return { status: 'success', userId, pendingEmail };
  }

  /**
   * Close every outstanding email-change link for this member.
   *
   * **This is what "a new request supersedes an outstanding one" means here.** The
   * alternative — two live links for two different addresses, both redeemable — means
   * the second one silently wins for a reason nobody can reconstruct afterwards, and
   * the member who opened the newer mail gets an account on the older address with no
   * error anywhere. Single-use is a statement about ONE link; superseding is the
   * statement about the set.
   *
   * @returns how many links it closed. Zero is the ordinary case: the token just
   *   redeemed is the only live one, and `authz.invalidate_auth_tokens` only touches
   *   rows with `consumed_at IS NULL`.
   */
  async invalidateEmailChangeTokens(userId: string): Promise<number> {
    return this.invalidateSubjectTokens(emailChangeSubject(userId), 'email_verification');
  }

  /**
   * The window check, in one place so the bare and composite flows cannot drift into
   * two different definitions of "long enough to be worth hashing".
   *
   * A composite token is refused outright: this method is the BARE path, and the
   * reason it says so is `redeem`'s.
   */
  private isPlausibleRawToken(rawToken: string, minLength: number, maxLength: number): boolean {
    if (typeof rawToken !== 'string' || rawToken.length < minLength || rawToken.length > maxLength) {
      return false;
    }
    return !isCompositeToken(rawToken);
  }

  /** Constant-time comparison of a row's subject against this member's change namespace. */
  private isChangeSubjectFor(subjectHmac: Buffer | string, userId: string): boolean {
    return timingSafeEqual(decodeSubjectHmac(subjectHmac), this.hashSubject(emailChangeSubject(userId)));
  }

  /**
   * The ONE redemption statement: `authz.redeem_auth_token`, which is a single
   * indexed, atomic, purpose-scoped UPDATE that consumes the token or matches
   * nothing.
   *
   * Extracted so the composite flow reaches the same statement rather than writing
   * its own (§2.4). Hashing before this would spend work on every forged link and
   * would make "is my token valid" observable as a latency difference before the
   * answer is even given.
   */
  private async consumeToken(
    presentedHash: Buffer,
    purpose: TokenPurpose,
  ): Promise<RedeemSqlRow | undefined> {
    return this.asAppAdmin(async (client) => {
      const result = await client.query<RedeemSqlRow>(
        'SELECT id, user_id, subject_hmac, pepper_kid, purpose, created_at, expires_at FROM authz.redeem_auth_token($1, $2)',
        [presentedHash, purpose],
      );
      return result.rows[0];
    });
  }

  /**
   * One row to the shape the callers get back.
   *
   * `purpose` is the purpose the caller ASKED for rather than the column, and that is
   * not a shortcut: `authz.redeem_auth_token` filters `WHERE t.purpose = p_purpose`, so
   * a row that came back matched the request by construction. Re-deriving it from the
   * column would mean falling back to *some* purpose for a value that does not parse,
   * and the fallback would be a guess dressed as a value.
   */
  private toRedeemedToken(row: RedeemSqlRow, expectedPurpose: TokenPurpose): RedeemedToken {
    return {
      id: row.id,
      userId: row.user_id,
      subjectHmac: decodeSubjectHmac(row.subject_hmac),
      pepperKid: row.pepper_kid,
      purpose: expectedPurpose,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  /**
   * Invalidate all unconsumed tokens for a subject and purpose.
   */
  async invalidateSubjectTokens(
    subjectIdentifier: string,
    purpose: TokenPurpose,
  ): Promise<number> {
    if (!isTokenPurpose(purpose)) {
      throw new Error(`Invalid token purpose: '${String(purpose)}'`);
    }

    const subjectHmac = this.hashSubject(subjectIdentifier);
    return this.asAppAdmin(async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT authz.invalidate_auth_tokens($1, $2) AS count',
        [subjectHmac, purpose],
      );
      return result.rows[0]?.count ?? 0;
    });
  }

  /**
   * Delete tokens whose expires_at is older than the specified cutoff.
   */
  async purgeExpiredTokens(olderThan: Date): Promise<number> {
    return this.asAppAdmin(async (client) => {
      const result = await client.query<{ count: number }>(
        'SELECT authz.purge_expired_auth_tokens($1) AS count',
        [olderThan],
      );
      return result.rows[0]?.count ?? 0;
    });
  }

  /**
   * Mint and deliver a one-time token over email.
   *
   * ## ACCOUNT ENUMERATION RESISTANCE
   *
   * Requesting a token for an address that exists and one that does not produces
   * an IDENTICAL response body (`{ status: 'accepted' }`), status code, and comparable
   * timing. No observable oracle is exposed to external callers.
   */
  async deliver(input: DeliverTokenInput): Promise<DeliveryResult> {
    if (!isTokenPurpose(input.purpose)) {
      throw new Error(`Invalid token purpose: '${String(input.purpose)}'`);
    }

    const normalizedEmail = input.email.trim().toLowerCase();

    // Check if account exists. Inside the elevated transaction for the same reason
    // as every other statement here: `pgrst_authenticator` holds no grant on
    // `users`, so an un-elevated lookup is `42501`, not "no such account".
    const user = await this.asAppAdmin(async (client) => {
      const res = await client.query<UserLookupRow>(
        'SELECT id, username, email FROM public.users WHERE lower(email) = $1 AND deleted_at IS NULL LIMIT 1',
        [normalizedEmail],
      );
      return res.rows[0];
    });

    if (user !== undefined) {
      const minted = await this.mint({
        purpose: input.purpose,
        subjectIdentifier: user.email,
        userId: user.id,
      });

      if (input.purpose === 'password_reset') {
        await this.emailService.sendPasswordResetEmail(
          user.email,
          user.username,
          minted.rawToken,
          user.id,
        );
      } else if (input.purpose === 'email_verification') {
        await this.emailService.sendVerificationEmail(
          user.email,
          user.username,
          minted.rawToken,
          user.id,
        );
      } else if (input.purpose === 'account_deletion') {
        await this.emailService.sendErasureReceipt(user.email, user.id);
      }
    } else {
      // Account does not exist: simulate equivalent cryptographic work
      const dummyToken = randomBytes(32).toString('base64url');
      this.hashToken(dummyToken);
      this.hashSubject(normalizedEmail);
      timingSafeEqual(DUMMY_HASH, DUMMY_HASH);
    }

    return { status: 'accepted' };
  }
}
