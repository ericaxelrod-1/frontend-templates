import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type { Environment } from '../config/environment.js';
import { EmailModule } from '../email/email.module.js';

/**
 * W11 slice 2 — login, JWT issuance, refresh-token rotation and logout.
 * Rate limiting, CAPTCHA and password reset are later slices (rebase.md
 * W11); nothing here pretends otherwise.
 *
 * `EmailModule` is imported so the verification and reset mails have one
 * configured provider behind them. No route in this module sends one yet, and
 * that is stated rather than stubbed: `POST /auth/register` and
 * `POST /auth/password-reset/request` need a token table and a migration, which
 * is a later slice. A `sendVerificationEmail(...)` call with nowhere real to
 * call from would be a stub that reads as a feature (`AGENTS.md` §2.1), so the
 * wiring stops at the module edge and `docs/adr.md` ADR-0024 records it.
 */
@Module({
  imports: [
    ConfigModule,
    EmailModule,
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
  providers: [AuthService],
  // The JwtService registered above is the same instance the global
  // JwtAuthGuard (AppModule) verifies with — one issuer, one verifier.
  exports: [JwtModule],
})
export class AuthModule {}
