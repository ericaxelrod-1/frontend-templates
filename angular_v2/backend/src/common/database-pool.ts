import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { Environment } from '../config/environment.js';

/**
 * The connection source a database-touching service needs, and nothing more.
 *
 * **One port, not one per feature.** `PurgeConnectionSource`,
 * `ErasureConnectionSource` and `TokenConnectionSource` were three identical
 * structural types in three files, which is §2.4's duplicate mechanism in its purest
 * form: a fourth feature needed a fourth copy, and a change to the port's shape would
 * have had to be made three times. `pg.Pool` satisfies this structurally, and it is
 * the only thing ever bound to it in application code (§2.2).
 *
 * The narrowness is load-bearing, not decoration: it is what lets a unit suite assert
 * that a **gated** dispatch never reaches the database at all — the strongest
 * available statement that the breaker gate is a dispatch decision and not a slow
 * rejection — without standing up a cluster and without a stand-in for a real
 * integration in application code.
 */
export type DatabaseConnectionSource = {
  connect(): Promise<PoolClient>;
};

/**
 * The whole connection budget this process has, as ONE number.
 *
 * `pg`'s default is 10, which is a number nobody chose, so this is explicit (§B6).
 * It is the **sum of the five per-feature maxima it replaces** — `AuthService` 10,
 * `EmailAuditWriter` 10, `PurgeModule` 4, `ErasureModule` 4, `TokenModule` 5 — and
 * that is deliberate: the sum is the only property that mattered, because each pool
 * was individually within budget while their total could still exhaust the server's
 * `max_connections`, and **no pool could see another's `waitingCount`**, so nothing
 * anywhere reported it. One pool makes the total a single readable number, which is
 * the entire point of the consolidation.
 */
export const DATABASE_POOL_MAX = 33;

/**
 * Idle connections are released after this long.
 *
 * `purge.module.ts` carried 30 s for its own pool; it is the pool-wide value now,
 * because a pool has one.
 */
export const DATABASE_POOL_IDLE_TIMEOUT_MS = 30_000;

/**
 * THE pool, owned by the DI container, built lazily.
 *
 * ## What this replaces, and why it was a real defect
 *
 * Four pools, one per consumer: `AuthService`, `EmailAuditWriter`, `PurgeModule` and
 * `ErasureModule` each called `new Pool(...)`, and `TokenModule` a fifth. Each read
 * the connection configuration for itself. The consequence was not stylistic: a
 * process could exceed the server's `max_connections` with **no signal anywhere**,
 * because every pool was individually healthy and none could see another's
 * `waitingCount` or `totalCount`. `purge.module.ts` and `erasure.module.ts` each
 * documented that defect and each declined to fix it — two documented instances of a
 * known problem is itself the problem, because a reader of either file cannot tell
 * whether it is handled.
 *
 * ## One pool, one read of the configuration, one close
 *
 * `AuthService`, `EmailAuditWriter`, `PurgeSweeper`, `PurgeEnqueuer`,
 * `ErasureService` and `TokenService` now receive THIS object. The pool is created
 * on first `connect()` rather than in the constructor because `pg.Pool` connects
 * lazily and a provider that is never used should open no socket — which is what
 * keeps the transport-only unit suites, which point at a database that does not
 * exist, from hanging on an un-closed handle.
 *
 * ## What is lost, stated rather than discovered
 *
 * **Per-feature connection caps.** A `pg.Pool` has exactly one `max`; per-feature
 * admission control on a shared pool is a limiter, not pool configuration, and
 * nothing in this template needs one. So the isolation the five maxima provided —
 * a slow retention drain could not occupy a connection the login path wanted — is
 * traded for the single visible budget. If that trade ever bites, the fix is a
 * per-consumer semaphore around `connect()`, not a second pool: two pools are what
 * made the saturation invisible in the first place.
 *
 * **Nothing else is lost.** The login, escalation and `SET LOCAL ROLE` boundary is
 * per connection and per transaction, not per pool: every consumer still runs
 * `BEGIN` → `SET LOCAL ROLE app_admin` → work → `COMMIT` on the connection it
 * borrows, which is exactly what it did with a pool of its own.
 */
@Injectable()
export class SharedDatabasePool implements DatabaseConnectionSource, OnApplicationShutdown {
  private readonly env: Environment;
  private pool: Pool | undefined;

  constructor(config: ConfigService) {
    // The one validated `Environment`, never `process.env` read a second time
    // (§2.3: no config key read with a default that masks a missing namespace).
    this.env = config.getOrThrow<Environment>('environment');
  }

  connect(): Promise<PoolClient> {
    this.pool ??= new Pool({
      host: this.env.database.host,
      port: this.env.database.port,
      // `pgrst_authenticator` — the escalation boundary every writer crosses, and
      // the same login role PostgREST uses (`scripts/postgrest-connection.ts`).
      user: this.env.authenticator.user,
      password: this.env.authenticator.password,
      database: this.env.database.database,
      max: DATABASE_POOL_MAX,
      idleTimeoutMillis: DATABASE_POOL_IDLE_TIMEOUT_MS,
    });
    return this.pool.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    // Cleared BEFORE the await, so a second shutdown pass cannot call `end()` on a
    // closed pool — which rejects with "Called end on pool more than once". Nest
    // calls destroy hooks on both app-close and module-close.
    const pool = this.pool;
    this.pool = undefined;
    if (pool !== undefined) {
      await pool.end();
    }
  }
}