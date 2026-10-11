import './config/load-env-file.js';
import { Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { loadEnvironment } from './config/environment.js';

/**
 * The environment is read and validated at module-evaluation time, after `.env`
 * is loaded and before `ConfigModule.forRoot()` and before any Nest call. An
 * unusable environment then fails the process with one attributed error naming
 * every problem, rather than a rejected promise from inside module
 * initialisation where nothing explains what was wrong.
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
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
