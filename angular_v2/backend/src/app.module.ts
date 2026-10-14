import './config/load-env-file.js';
import { Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { BreakerModule } from './breaker/breaker.module.js';
import { PurgeModule } from './purge/purge.module.js';
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
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
