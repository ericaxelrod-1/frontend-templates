import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { BreakerModule } from '../breaker/breaker.module.js';
import type { Environment } from '../config/environment.js';
import { PURGE_POOL, PurgeSweeper } from './purge-sweeper.service.js';
import { SqlPurgeExecutor } from './purge-executor.js';
import { PURGE_EXECUTOR } from './purge-executor.js';

/** Explicit, because `pg`'s default of 10 is a number nobody chose (§B6). */
const PURGE_POOL_MAX = 4;

const PURGE_POOL_IDLE_TIMEOUT_MS = 30_000;

/**
 * The purge sweeper, and the pool it talks to.
 *
 * ## The pool, and the known duplication
 *
 * `AuthService` builds one `Pool` in its constructor and `EmailAuditWriter` builds
 * a second on first use, and this module builds a third. That is a real
 * duplication and a real problem — **neither pool can see the other's
 * `waitingCount`**, which is how a service exceeds `max_connections` with no alarm
 * anywhere: both report themselves healthy while the database saturates.
 *
 * The fix is one shared pool provider that `AuthModule` and `EmailModule` also
 * consume, and it is **not made here**: both are outside this change's ownership,
 * and re-plumbing them is a wider edit than the defect. What this module does do
 * is the half that is its own — an **explicit `max`**, so this pool is not on an
 * unchosen default, and the same `pgrst_authenticator` login plus
 * `SET LOCAL ROLE app_admin` escalation boundary every other writer uses, read
 * from the one validated `Environment` rather than from `process.env` a second
 * time (§2.3: no config key read with a default that masks a missing namespace).
 *
 * `pg.Pool` connects lazily, so a process whose scheduler never starts opens no
 * socket — the same property `email-audit.writer.ts` relies on.
 *
 * ## Why the executor is a token
 *
 * One implementation, registered once behind `PurgeExecutor` (§2.4), so the reason
 * table is one object with one interface rather than a `switch` buried in the
 * sweeper's transaction. There is no second binding and no factory a stand-in
 * could be registered through outside a test file (§2.2).
 */
@Module({
  imports: [BreakerModule, ConfigModule],
  providers: [
    {
      provide: PURGE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const env = config.getOrThrow<Environment>('environment');
        return new Pool({
          host: env.database.host,
          port: env.database.port,
          user: env.authenticator.user,
          password: env.authenticator.password,
          database: env.database.database,
          max: PURGE_POOL_MAX,
          idleTimeoutMillis: PURGE_POOL_IDLE_TIMEOUT_MS,
        });
      },
    },
    { provide: PURGE_EXECUTOR, useClass: SqlPurgeExecutor },
    PurgeSweeper,
  ],
})
export class PurgeModule {}