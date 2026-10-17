import { Module } from '@nestjs/common';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { EmailModule } from '../email/email.module.js';
import { ERASURE_ENV, loadErasureEnvironment } from './erasure-environment.js';
import { ErasureService } from './erasure.service.js';
import { PrivacyController } from './privacy.controller.js';

/**
 * The erasure namespace, read and validated at **module-evaluation time** — after
 * `.env` is loaded (`app.module.ts:1`) and before `ConfigModule.forRoot()`, before
 * any Nest call and therefore before any route exists.
 *
 * The same moment and the same shape as `APP_RETENTION_ENVIRONMENT`
 * (`purge.module.ts`) and `APP_BREAKER_ENVIRONMENT`, for the same reason: a key
 * that signs every tombstone must be refused before the process has acted on it,
 * and a default nobody chose would be a published key.
 */
export const APP_ERASURE_ENVIRONMENT = loadErasureEnvironment(process.env);

/**
 * The erasure service and the pool it talks to.
 *
 * ## The pool
 *
 * `SharedDatabasePool` — ONE pool for the whole process, imported from
 * `common/database-pool.module.ts` like every other writer. This module used to
 * build its own and used to carry its own copy of the paragraph `purge.module.ts`
 * carried, declining to fix the same duplication for the same reason. One mechanism
 * now, and both paragraphs are deleted rather than rewritten: two comments
 * describing a resolved defect are two comments the next reader has to check.
 *
 * The per-feature `max: 4` this pool carried is gone, because a `pg.Pool` has exactly
 * one `max` and the process-wide budget is now one readable number — see
 * `common/database-pool.ts` §What is lost for what that trades and why.
 *
 * ## It is NOT part of the retention mechanism
 *
 * `PurgeModule` is imported nowhere here and `ErasureModule` imports nothing from
 * it. Erasure is immediate on confirmation and soft; retention is later and hard,
 * over accounts nobody asked to leave (`0011:214-249`). Sharing a module between
 * them would put the two in the same dependency graph, and the next reader would
 * reasonably wonder which of them a given statement belongs to. They now share one
 * POOL, which is a different thing and is the right amount of shared: the
 * connections are interchangeable, the lifecycles are not.
 */
@Module({
  imports: [EmailModule, DatabasePoolModule],
  controllers: [PrivacyController],
  providers: [{ provide: ERASURE_ENV, useValue: APP_ERASURE_ENVIRONMENT }, ErasureService],
  exports: [ErasureService],
})
export class ErasureModule {}