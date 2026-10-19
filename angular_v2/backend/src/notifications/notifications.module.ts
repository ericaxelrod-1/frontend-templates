import { Module } from '@nestjs/common';
import { BreakerModule } from '../breaker/breaker.module.js';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { NotificationMaterializer } from './notification-materializer.service.js';
import { loadNotificationEnvironment } from './notification-environment.js';
import { NOTIFICATIONS_ENV } from './notification-environment.js';

/**
 * The `NOTIFICATIONS_*` namespace, read and validated at **module-evaluation time** —
 * after `.env` is loaded (`app.module.ts:1`) and before `ConfigModule.forRoot()`,
 * before any Nest call, and therefore before `NotificationMaterializer` registers its
 * interval.
 *
 * The same moment and the same shape as `APP_RETENTION_ENVIRONMENT` and
 * `APP_BREAKER_ENVIRONMENT`. This namespace is the one of the four whose keys are all
 * allowed to default, so the boot-time refusal here is narrower than the others' — it
 * fires on a MALFORMED value rather than a missing one — and that is stated rather than
 * left to be discovered: `NOTIFICATIONS_LOOKBACK_SECONDS=1h` must not boot a
 * materialiser whose overlap is `NaN`, because a materialiser with no overlap is
 * exactly the silently-backdated-record-loss the overlap exists to prevent.
 */
export const APP_NOTIFICATION_ENVIRONMENT = loadNotificationEnvironment(process.env);

/**
 * The materialiser job, and the pool it writes through.
 *
 * ## `SharedDatabasePool`
 *
 * ONE pool for the whole process (`common/database-pool.module.ts`), like every other
 * writer. This module does not build a second one: two pools are what made connection
 * saturation invisible in the first place, because neither could see the other's
 * `waitingCount`.
 *
 * ## Why the job is not in `PurgeModule`
 *
 * It is the same shape as the two retention jobs — gated, scheduled, idempotent — and
 * that resemblance is the point rather than an argument for folding it in. Retention
 * DESTROWS rows and its windows are required with no default; this one RENDERS rows
 * and its windows are scheduling facts with defaults. Two different rules, two
 * different failure directions, two modules: `purge/` for the machinery that removes
 * personal data and `notifications/` for the machinery that shows it. §2.4's "one
 * mechanism per concern" cuts the other way here — one MODULE per concern, so an
 * operator who opens `purge/` never has to wonder whether something in it can be
 * configured by a default.
 *
 * ## No routes, and no dispatch token in `BREAKER_PROTECTED`
 *
 * There is nothing to mount: the materialiser is a job, and the panel it feeds is
 * PostgREST serving `public.admin_notifications` directly (§B1 — pure CRUD over a
 * table gets no controller). `NOTIFICATIONS_MATERIALIZE` is in
 * `KNOWN_DISPATCH_TOKENS` so the scheduler, the breaker gate and the lock-key
 * derivation all speak one vocabulary, and it is deliberately absent from
 * `BREAKER_PROTECTED`; `src/breaker/dispatch-token.ts` says why at length.
 */
@Module({
  imports: [BreakerModule, DatabasePoolModule, SchedulerModule],
  providers: [{ provide: NOTIFICATIONS_ENV, useValue: APP_NOTIFICATION_ENVIRONMENT }, NotificationMaterializer],
})
export class NotificationsModule {}