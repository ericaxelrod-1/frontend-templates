import { Injectable, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { Environment } from '../config/environment.js';
import { ipSubnetKey, normalizeIpAddress } from './ip-address.js';
import { delayForFailures, isBlocked } from './throttle.js';
import { uuidv7 } from './uuidv7.js';
import type { LoginRequestDto } from './login-request.dto.js';
import type { LoginResponseDto } from './login-response.dto.js';
import type { LogoutRequestDto } from './logout-request.dto.js';
import type { RefreshRequestDto } from './refresh-request.dto.js';
import type { RefreshResponseDto } from './refresh-response.dto.js';

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string;
}

/**
 * Constant dummy password hash at the same bcrypt cost the seed uses, so an
 * unknown username burns exactly the same compare cost as a wrong password for
 * a real account. Without this, a missed login is measurably faster than a
 * wrong-password login and leaks which accounts exist (§2.3). Verified false
 * against every input, so the branch below treats it as a non-match.
 */
const UNKNOWN_USER_PASSWORD_HASH = bcrypt.hashSync('username-oracle-canary', 12);

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
export class AuthService implements OnModuleDestroy {
  private readonly env: Environment;
  private readonly pool: Pool;

  constructor(
    config: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.env = config.getOrThrow<Environment>('environment');
    this.pool = new Pool({
      host: this.env.database.host,
      port: this.env.database.port,
      user: this.env.authenticator.user,
      password: this.env.authenticator.password,
      database: this.env.database.database,
    });
  }

  private destroyed = false;

  async onModuleDestroy(): Promise<void> {
    // Nest calls the destroy hook on both app-close and module-close; the
    // pg Pool rejects a second end() with "Called end on pool more than once".
    if (!this.destroyed) {
      this.destroyed = true;
      await this.pool.end();
    }
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

    const gate = await this.loginGate(dto.username, ip, normalizedIp, subnet, allowlisted);
    if (gate.blocked) {
      throw new UnauthorizedException('invalid credentials');
    }
    if (gate.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, gate.delayMs));
    }

    return this.issueSession(dto, gate.attemptId);
  }

  /**
   * Phase 1: counts recent failures, decides the gate, writes the audit
   * row with status='failed' — committed before any credential check, so
   * the attack surface is recorded even when the request dies before
   * bcrypt. Allowlisted source IPs are never blocked and never delayed;
   * their rows carry NULL canonical keys so the counters never see them.
   */
  private async loginGate(
    username: string,
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

      const accountFailures = await this.countRecentFailures(client, username, null, this.env.security.failureWindowSeconds);
      const ipFailures =
        subnet === ''
          ? 0
          : await this.countRecentFailures(client, null, subnet, this.env.security.failureWindowSeconds);

      const blocked =
        !allowlisted &&
        (isBlocked(accountFailures, this.env.security.blockThreshold) ||
          isBlocked(ipFailures, this.env.security.blockThreshold));
      const delayMs = allowlisted
        ? 0
        : Math.max(
            delayForFailures(accountFailures, this.env.security.delayScheduleSeconds, this.env.security.delayCapSeconds),
            delayForFailures(ipFailures, this.env.security.delayScheduleSeconds, this.env.security.delayCapSeconds),
          );

      const tracked = !allowlisted && subnet !== '';
      const attemptId = await this.recordAttempt(
        client,
        username,
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
   */
  private async countRecentFailures(
    client: PoolClient,
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
         WHERE username = $1 AND status = 'failed' AND ip_normalized IS NOT NULL
           AND created_at >= now() - make_interval(secs => $2)
           AND created_at > COALESCE(
             (SELECT max(created_at) FROM login_attempts
               WHERE username = $1 AND status = 'succeeded'),
             '-infinity'::timestamptz)`,
        [username, windowSeconds],
      );
      return result.rows[0]?.count ?? 0;
    }
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM login_attempts
       WHERE ip_subnet = $1 AND status = 'failed' AND ip_subnet IS NOT NULL
         AND created_at >= now() - make_interval(secs => $2)
         AND created_at > COALESCE(
           (SELECT max(created_at) FROM login_attempts
             WHERE ip_subnet = $1 AND status = 'succeeded'),
           '-infinity'::timestamptz)`,
      [subnet, windowSeconds],
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
   */
  async logout(dto: LogoutRequestDto): Promise<void> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      const tokenHash = createHash('sha256').update(dto.refreshToken).digest('hex');
      const result = await client.query<{ id: string }>(
        'SELECT id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      );
      const row = result.rows[0];
      if (row !== undefined) {
        await this.revokeFamily(client, row.id);
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

  private async recordAttempt(
    client: PoolClient,
    username: string,
    ip: string | null,
    ipNormalized: string | null,
    ipSubnet: string | null,
    status: 'failed' | 'succeeded',
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      'INSERT INTO login_attempts (username, ip, ip_normalized, ip_subnet, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, ip, ipNormalized, ipSubnet, status],
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
