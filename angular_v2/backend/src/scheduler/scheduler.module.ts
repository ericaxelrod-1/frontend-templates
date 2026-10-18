import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { JobRunner } from './job-runner.service.js';

/**
 * The scheduler, and the schedule library this application runs on.
 *
 * ## `ScheduleModule.forRoot()` lives HERE, not in `app.module.ts` and not in `breaker.module.ts`
 *
 * `breaker.module.ts` registered it while the breaker was the only thing with a
 * clock, and moving it here is what makes the dependency legible: the breaker
 * *consumes* the scheduler (its meter and its gate register intervals in this
 * registry), so a reader of `breaker.module.ts` sees an import of a module it needs
 * rather than a `forRoot()` that appears to be about the breaker.
 *
 * `forRoot()` returns `global: true`, so `SchedulerRegistry` resolves in any module
 * once this one is loaded — which is how `BreakerGate` and `BreakerMeter` keep
 * injecting it. **This module therefore exports only `JobRunner`**, because Nest
 * refuses to re-export a provider a module does not itself provide
 * (`addExportedProvider`: "cannot export a provider/module that is not a part of the
 * currently processed module"), and a re-export here would be a claim the container
 * checks rather than takes.
 *
 * ## Why not `@Global()`
 *
 * `AGENTS.md` §B7: a module imported explicitly by the features that need it is
 * easier to read than one every feature can reach, and the import list is the
 * evidence that a consumer was migrated rather than silently left behind.
 *
 * ## Why the runner is a provider here rather than a function
 *
 * It holds the connection coordinates and the `SchedulerRegistry`, and both are
 * already in this container. A job takes its runner by injection, so the guarantee
 * "this job body is wrapped in a lock" is a constructor argument rather than a
 * convention — and a convention is what the previous tree had, with the interval,
 * the error handling and the exclusivity each answered separately.
 */
@Module({
  imports: [ConfigModule, ScheduleModule.forRoot()],
  providers: [JobRunner],
  exports: [JobRunner],
})
export class SchedulerModule {}