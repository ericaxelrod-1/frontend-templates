import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { loadBreakerEnvironment } from './breaker-environment.js';
import { BREAKER_ENV } from './breaker-environment.js';
import { BreakerGate } from './breaker-gate.js';
import { BreakerGateInterceptor } from './breaker.interceptor.js';
import { BreakerMeter } from './breaker-meter.js';
import { BreakerRegistry } from './breaker-registry.js';
import { MEMORY_PROBE, nodeMemoryProbeDeps } from './node-memory-probe.js';

/**
 * The breaker configuration, read and validated at **module-evaluation time** —
 * after `.env` is loaded (`app.module.ts:1`) and before `ConfigModule.forRoot()`,
 * before any Nest call, and therefore before either job can register its first
 * interval.
 *
 * This is the same moment and the same shape as `loadEnvironment`, and for the
 * same reason: a control whose entire value proposition is refusing bad
 * configuration must refuse it *before* it has acted on it. A `@Cron`-bound meter
 * takes its first reading during `OnModuleInit`; validating there would mean the
 * first publication came from an unvalidated configuration.
 */
export const APP_BREAKER_ENVIRONMENT = loadBreakerEnvironment(process.env);

/**
 * The breaker, and the schedule library it needs.
 *
 * `ScheduleModule.forRoot()` is registered here rather than in `app.module.ts`
 * beside the `APP_INTERCEPTOR`, so the two halves of the change — the decision
 * and the clock that drives it — travel together and neither can be deleted
 * without the other failing visibly.
 *
 * ## Why `@nestjs/schedule` at all, given this tree's stated preference
 *
 * `docs/rebase.md` §9A.3 recommends against it for the *sweeper* and §9B.8
 * recommends it for the *breaker*; those two are not consistent, and the
 * reconciliation is that neither of them was executed, so neither got the last
 * word. What is actually load-bearing is the ORDERING argument both paragraphs
 * make: `@Cron` binds its handler during `OnModuleInit`, which Nest runs before
 * `OnApplicationBootstrap`, so a job bound by a decorator can act on
 * configuration that has not been asserted yet.
 *
 * This build takes the ordering without the decorator: both jobs register through
 * `SchedulerRegistry` in `onApplicationBootstrap`, which is strictly later than
 * the module-evaluation-time `loadBreakerEnvironment(...)` above. So the
 * scheduling library is here for the reason that is actually true — a real,
 * inspectable registry of named intervals that are cleared on shutdown, rather
 * than a bare `setInterval` nobody can see — and not for `@Cron`.
 *
 * ## Why `ScheduleModule` is not `@Global()`
 *
 * `AGENTS.md` §B7: a module imported explicitly by the one feature that needs it
 * is easier to read than one every feature can reach. The purge module imports
 * this one; nothing else does.
 *
 * ## Why there is exactly one binding of the memory probe
 *
 * `MEMORY_PROBE` resolves to `nodeMemoryProbeDeps()` — the real `fs` and `os`.
 * There is no alternative registration and no factory that could be swapped for a
 * stand-in at runtime; the shape exists so the unit suite can pass a fixture
 * without the application being able to (`AGENTS.md` §2.2).
 */
@Module({
  imports: [ConfigModule, ScheduleModule.forRoot()],
  providers: [
    { provide: BREAKER_ENV, useValue: APP_BREAKER_ENVIRONMENT },
    { provide: MEMORY_PROBE, useFactory: (): ReturnType<typeof nodeMemoryProbeDeps> => nodeMemoryProbeDeps() },
    BreakerRegistry,
    BreakerMeter,
    BreakerGate,
    { provide: APP_INTERCEPTOR, useClass: BreakerGateInterceptor },
  ],
  exports: [BreakerRegistry, BreakerGate, BREAKER_ENV],
})
export class BreakerModule {}