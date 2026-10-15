import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { EmailModule } from '../email/email.module.js';
import { ERASURE_ENV, loadErasureEnvironment } from './erasure-environment.js';
import { ERASURE_POOL, ErasureService } from './erasure.service.js';

/** Explicit, because `pg`'s default of 10 is a number nobody chose (§B6). */
const ERASURE_POOL_MAX = 4;

/**
 * The erasure namespace, read and validated at **module-evaluation time** — after
 * `.env` is loaded (`app.module.ts:1`) and before `ConfigModule.forRoot()`, before
 * any Nest call and therefore before any route exists.
 *
 * The same moment and the same shape as `APP_RETENTION_ENVIRONMENT`
 * (`purge.module.ts:28`) and `APP_BREAKER_ENVIRONMENT`, for the same reason: a key
 * that signs every tombstone must be refused before the process has acted on it,
 * and a default nobody chose would be a published key.
 */
export const APP_ERASURE_ENVIRONMENT = loadErasureEnvironment(process.env);

/**
 * The erasure service and the pool it talks to.
 *
 * ## The pool, and the duplication this repeats
 *
 * `AuthService`, `EmailAuditWriter` and `PurgeModule` each build their own. That is
 * a real problem — no pool can see another's `waitingCount`, so a service exceeds
 * `max_connections` with no alarm anywhere — and `purge.module.ts:33-49` already
 * records both the defect and the fix (one shared pool provider) and declines to
 * make it, because re-plumbing the other three is a wider edit than this feature
 * is. This module does the half that is its own: an explicit `max`, and the same
 * `pgrst_authenticator` login every other writer uses, read from the one validated
 * `Environment` rather than from `process.env` a second time.
 *
 * `pg.Pool` connects lazily, so a process that never erases anybody opens no socket.
 *
 * ## It is NOT part of the retention mechanism
 *
 * `PurgeModule` is imported nowhere here and `ErasureModule` imports nothing from
 * it. Erasure is immediate on confirmation and soft; retention is later and hard,
 * over accounts nobody asked to leave (`0011:214-249`). Sharing a module between
 * them would put the two in the same dependency graph, and the next reader would
 * reasonably wonder which of them a given statement belongs to.
 */
@Module({
  imports: [ConfigModule, EmailModule],
  providers: [
    {
      provide: ERASURE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const env = config.getOrThrow<Environment>('environment');
        return new Pool({
          host: env.database.host,
          port: env.database.port,
          user: env.authenticator.user,
          password: env.authenticator.password,
          database: env.database.database,
          max: ERASURE_POOL_MAX,
        });
      },
    },
    { provide: ERASURE_ENV, useValue: APP_ERASURE_ENVIRONMENT },
    ErasureService,
  ],
  exports: [ErasureService],
})
export class ErasureModule {}