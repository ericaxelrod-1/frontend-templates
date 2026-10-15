import './config/load-env-file.js';
import { Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { BreakerModule } from './breaker/breaker.module.js';
import { PurgeModule } from './purge/purge.module.js';
import { ErasureModule } from './privacy/erasure.module.js';
import { loadEnvironment } from './config/environment.js';

/**
 * The environment is read and validated at module-evaluation time, after `.env`
 * is loaded and before `ConfigModule.forRoot()` and before any Nest call. An
 * unusable environment then fails the process with one attributed error naming
 * every problem, rather than a rejected promise from inside module
 * initialisation where nothing explains what was wrong.
 *
 * The breaker's `BREAKER_*` keys are read and validated the same way, one import
 * deeper — see the module-evaluation-time statement at the top of
 * `breaker.module.ts`. Same moment, same shape, same reason: a control whose value
 * proposition is refusing bad configuration must refuse it before it has acted on
 * it, and both jobs register their first interval in `onApplicationBootstrap`,
 * which is strictly later than all of this.
 *
 * The erasure namespace's `PRIVACY_*` keys are a third such statement, one import
 * deeper again (`privacy/erasure.module.ts`), for the same reason and with more
 * force than either of the others: a default pepper is a published key.
 */
export const APP_ENVIRONMENT = loadEnvironment(process.env);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `.env` is already loaded above; loading it again would be a second
      // mechanism for the same job.
      ignoreEnvFile: true,
      load: [registerAs('environment', () => APP_ENVIRONMENT)],
    }),
    AuthModule,
    // The gate is an APP_INTERCEPTOR (registered inside BreakerModule, beside the
    // APP_GUARD below), so it runs AFTER JwtAuthGuard: middleware → guards →
    // interceptors → pipes → handler. A resource gate ahead of authentication
    // would hand an unauthenticated prober a capacity verdict.
    BreakerModule,
    PurgeModule,
    // The erasure OPERATION, mounted. Deliberately NOT the deletion-request
    // ROUTE: a thin-app route names no dispatch token until
    // `src/breaker/dispatch-token.ts` carries `privacy.submit` /
    // `privacy.confirm`, and `route-census.ts` refuses to boot a graph with a
    // mounted route it cannot name. Until that file changes, this module
    // contributes an operation with no HTTP edge — and registering it is what
    // makes the operation real rather than a file nothing imports.
    ErasureModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
