import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CaptchaService } from './captcha.service.js';
import type { Environment } from '../config/environment.js';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { EmailModule } from '../email/email.module.js';
import { TokenModule } from '../token/token.module.js';

/**
 * W11 — login, JWT issuance, refresh-token rotation, logout, and the four
 * one-time-token routes over `src/token/`.
 *
 * `TokenModule` is imported for `TokenService` — the mint / redeem / deliver
 * primitive and its `AUTH_TOKEN_*` environment — so this module owns no second
 * token machinery. It was previously imported for nothing, and the comment that
 * said so was the honest record of a route that did not exist yet:
 * `POST /auth/password-reset/request` and `POST /auth/register` "need a token
 * table and a migration, which is a later slice". The table and the migration
 * (`0018_auth_tokens.sql`) have landed, the routes are mounted, and the wiring
 * stops being a statement about the future. **Registration remains unmounted**
 * because it still does: there is no way to create a `users` row through any
 * public route, which is a different feature and is not faked here (§2.1).
 *
 * `EmailModule` is what `TokenService` reaches for when a link is delivered, so
 * there is one configured provider behind both flows rather than one per module.
 *
 * `DatabasePoolModule` is imported for the ONE pool `AuthService` reads and writes
 * through. `AuthService` used to build its own `pg.Pool` in its constructor — one of
 * four in this process, each unable to see another's `waitingCount` — and to end it
 * from its own destroy hook, which made it a second owner of a socket the rest of
 * the process had no handle on. See `src/common/database-pool.ts` §What this
 * replaces.
 */
@Module({
  imports: [
    ConfigModule,
    DatabasePoolModule,
    EmailModule,
    TokenModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { jwt } = config.getOrThrow<Environment>('environment');
        return {
          secret: jwt.secret,
          signOptions: {
            algorithm: 'HS256' as const,
            expiresIn: jwt.accessTokenTtlSeconds,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService],
  // The JwtService registered above is the same instance the global
  // JwtAuthGuard (AppModule) verifies with — one issuer, one verifier.
  exports: [JwtModule],
})
export class AuthModule {}
