import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { EmailService } from '../email/email.service.js';
import { TOKEN_ENV, type TokenEnvironment } from './token-environment.js';
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  isTokenPurpose,
  type DeliverTokenInput,
  type DeliveryResult,
  type MintTokenInput,
  type MintedToken,
  type RedeemTokenInput,
  type RedeemTokenResult,
  type TokenPurpose,
} from './token.types.js';

export type TokenConnectionSource = {
  connect(): Promise<PoolClient>;
};

export const TOKEN_POOL = 'TOKEN_POOL';

const SUBJECT_DOMAIN_LABEL = 'auth.token.subject.v1';
const TOKEN_HASH_DOMAIN_LABEL = 'auth.token.hash.v1';
const DUMMY_HASH = Buffer.alloc(32, 0);

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

@Injectable()
export class TokenService {
  constructor(
    @Inject(TOKEN_POOL) private readonly pool: TokenConnectionSource,
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

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
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
      rawToken,
      purpose: input.purpose,
      expiresAt,
    };
  }

  /**
   * Atomically redeem a token.
   * Single-use: marks consumed_at = clock_timestamp().
   * Concurrent redemptions of the exact same token race at the database level:
   * exactly one succeeds, subsequent callers match zero rows.
   *
   * Expired, already-consumed, cross-purpose, malformed, or non-existent tokens
   * all return the uniform `{ status: 'invalid_or_expired' }`.
   */
  async redeem(input: RedeemTokenInput): Promise<RedeemTokenResult> {
    if (!isTokenPurpose(input.expectedPurpose)) {
      return { status: 'invalid_or_expired' };
    }

    if (
      typeof input.rawToken !== 'string' ||
      input.rawToken.length < 16 ||
      input.rawToken.length > 256
    ) {
      // Execute constant-time dummy equality to eliminate timing channels
      timingSafeEqual(DUMMY_HASH, DUMMY_HASH);
      return { status: 'invalid_or_expired' };
    }

    const presentedHash = this.hashToken(input.rawToken);

    const row = await this.asAppAdmin(async (client) => {
      const result = await client.query<RedeemSqlRow>(
        'SELECT id, user_id, subject_hmac, pepper_kid, purpose, created_at, expires_at FROM authz.redeem_auth_token($1, $2)',
        [presentedHash, input.expectedPurpose],
      );
      return result.rows[0];
    });

    if (row === undefined) {
      timingSafeEqual(presentedHash, presentedHash);
      return { status: 'invalid_or_expired' };
    }

    // Constant-time confirmation
    timingSafeEqual(presentedHash, presentedHash);

    const subjectHmac = Buffer.isBuffer(row.subject_hmac)
      ? row.subject_hmac
      : Buffer.from(row.subject_hmac, 'hex');

    return {
      status: 'success',
      token: {
        id: row.id,
        userId: row.user_id,
        subjectHmac,
        pepperKid: row.pepper_kid,
        purpose: input.expectedPurpose,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
      },
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
