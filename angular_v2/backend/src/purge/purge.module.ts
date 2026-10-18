import { Module } from '@nestjs/common';
import { BreakerModule } from '../breaker/breaker.module.js';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { PurgeEnqueuer } from './purge-enqueuer.service.js';
import { PurgeSweeper } from './purge-sweeper.service.js';
import { SqlPurgeExecutor } from './purge-executor.js';
import { PURGE_EXECUTOR } from './purge-executor.js';
import { loadRetentionEnvironment } from './retention-environment.js';
import { RETENTION_ENV } from './retention-environment.js';

/**
 * The retention window, read and validated at **module-evaluation time** — after
 * `.env` is loaded (`app.module.ts:1`) and before `ConfigModule.forRoot()`, before
 * any Nest call, and therefore before either retention job registers its interval.
 *
 * The same moment and the same shape as `APP_BREAKER_ENVIRONMENT`, for the same
 * reason: `RETENTION_TOMBSTONE_DAYS` decides which users' rows are destroyed, so
 * a process that cannot name the window must refuse to start rather than start a
 * purge job with a window it invented. There is no default, in any mode.
 */
export const APP_RETENTION_ENVIRONMENT = loadRetentionEnvironment(process.env);

/**
 * The purge sweeper, and the pool it talks to.
 *
 * ## The pool
 *
 * `SharedDatabasePool` — ONE pool for the whole process, imported from
 * `common/database-pool.module.ts` like every other writer. This module used to
 * build a third pool of its own and used to carry a paragraph explaining why it did
 * not consolidate: *"neither pool can see the other's `waitingCount`, which is how a
 * service exceeds `max_connections` with no alarm anywhere."* The defect is fixed
 * and the paragraph is deleted rather than rewritten, because a comment that
 * documents a resolved defect is a comment the next reader has to check.
 *
 * The per-feature `max: 4` this pool used to carry is gone: a `pg.Pool` has exactly
 * one `max`, and the process-wide budget is now a single readable number. See
 * `common/database-pool.ts` §What is lost for what that trades away and why.
 *
 * Every write still crosses the same escalation boundary — `pgrst_authenticator`
 * logs in, and each transaction runs `SET LOCAL ROLE app_admin` before any write.
 * Claims alone cannot buy write access, because the `app_admin` branch of the policy
 * discriminates on `current_user` and never on a token field (§B2/§B5).
 *
 * ## Why the executor is a token
 *
 * One implementation, registered once behind `PurgeExecutor` (§2.4), so the reason
 * table is one object with one interface rather than a `switch` buried in the
 * sweeper's transaction. There is no second binding and no factory a stand-in
 * could be registered through outside a test file (§2.2).
 */
@Module({
  imports: [BreakerModule, DatabasePoolModule, SchedulerModule],
  providers: [
    { provide: PURGE_EXECUTOR, useClass: SqlPurgeExecutor },
    { provide: RETENTION_ENV, useValue: APP_RETENTION_ENVIRONMENT },
    PurgeSweeper,
    PurgeEnqueuer,
  ],
})
export class PurgeModule {}