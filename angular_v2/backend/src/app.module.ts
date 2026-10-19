import './config/load-env-file.js';
import { Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { BreakerModule } from './breaker/breaker.module.js';
import { PurgeModule } from './purge/purge.module.js';
import { ErasureModule } from './privacy/erasure.module.js';
import { TokenModule } from './token/token.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { UsersModule } from './users/users.module.js';
import { PostgrestModule } from './postgrest/postgrest.module.js';
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
    // `notifications.materialize`: the scheduled job that renders each registered
    // source into `public.admin_notifications`. No routes — the panel it feeds is
    // PostgREST serving that table directly (§B1).
    NotificationsModule,
    // The erasure operation and authenticated route (`POST /privacy/erase`),
    // dispatch token `privacy.erase` (named in KNOWN_DISPATCH_TOKENS and checked
    // by RouteCensus). NOT yet on the identity seam — see `privacy.controller.ts`.
    ErasureModule,
    // The shared one-time token primitive (mint, store, deliver, redeem, expire)
    // with no HTTP routes mounted directly.
    TokenModule,
    // The member's own profile (`GET|PATCH /users/me`, the two-phase address change,
    // the password change, the member's own login history) and the administrator's
    // `POST /users`. Seven routes, dispatch tokens `users.*`.
    UsersModule,
    // The identity seam: replaying a caller's verified bearer token into
    // PostgREST so the database resolves `authz.actor()` to that caller.
    // `UsersService.me` is its first production consumer — the one read that has to be
    // answered with the CALLER's privileges rather than a claimless admin session, and
    // so is bounded by their column grant and by `users_read_scope`.
    PostgrestModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
