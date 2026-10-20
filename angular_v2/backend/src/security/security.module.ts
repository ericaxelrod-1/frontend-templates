import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BreakerModule } from '../breaker/breaker.module.js';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { SecurityTelemetryInterceptor } from './security-telemetry.interceptor.js';
import { loadTelemetryEnvironment } from './telemetry-environment.js';
import { TELEMETRY_ENV } from './telemetry-environment.js';
import { SecurityTelemetryCollector } from './telemetry-collector.js';
import { SecurityTelemetryFlush } from './telemetry-flush.service.js';

/**
 * The `SECURITY_TELEMETRY_*` namespace, read and validated at **module-evaluation
 * time** — after `.env` is loaded (`app.module.ts:1`) and before `ConfigModule.forRoot()`,
 * before any Nest call, and therefore before the flush job registers its interval.
 *
 * The same moment and the same shape as `APP_RETENTION_ENVIRONMENT`,
 * `APP_BREAKER_ENVIRONMENT` and `APP_NOTIFICATION_ENVIRONMENT`: a control whose
 * value proposition is refusing bad configuration must refuse it *before* it has
 * acted on it.
 */
export const APP_TELEMETRY_ENVIRONMENT = loadTelemetryEnvironment(process.env);

/**
 * The security telemetry: the detector, the collector, and the flush job.
 *
 * ## WHY IT IS ITS OWN MODULE
 *
 * It is a feature with one concern — "what did a request look like, and what
 * follows from it" — and it touches four tables and no route. §B7's rule is one
 * service per concept, and this concept belongs to neither the auth feature (which
 * owns credentials) nor the notifications feature (which renders rows onto a
 * panel). Folding it into either would mean the auth module owns the reputation
 * score, or the notifications module owns the detector.
 *
 * ## THE TWO HALVES, AND WHY THEY ARE IN THE SAME MODULE
 *
 * The interceptor is the REQUEST half: it recognises a pattern and counts it.
 * The flush job is the WRITE half: it persists the aggregate, out of the request
 * path, under the scheduler's lock.
 *
 * **They are separate classes because they are separate concerns, and they are in
 * one module because they are two halves of one mechanism.** A detector with no
 * writer is a thing that recognises patterns and forgets them; a writer with no
 * detector is a table that fills with fixtures. The collector between them is
 * what makes the request half cheap and the write half aggregate.
 *
 * ## NO ROUTES
 *
 * Nothing here is mounted. The admin pages read the four tables through PostgREST
 * (§B1 — pure CRUD over a table gets no controller), and the notification panel
 * is fed by the existing materialiser, which already reads `security_alerts`.
 * A controller here would be a second way to reach rows that already have one.
 */
@Module({
  imports: [ConfigModule, BreakerModule, DatabasePoolModule, SchedulerModule],
  providers: [
    { provide: TELEMETRY_ENV, useValue: APP_TELEMETRY_ENVIRONMENT },
    SecurityTelemetryCollector,
    SecurityTelemetryFlush,
    // The detection point. Registered as an `APP_INTERCEPTOR` beside the breaker's
    // own, and it runs AFTER it: a gated request is not dispatched at all, and
    // there is nothing to detect about one.
    { provide: APP_INTERCEPTOR, useClass: SecurityTelemetryInterceptor },
  ],
  exports: [SecurityTelemetryCollector],
})
export class SecurityModule {}
