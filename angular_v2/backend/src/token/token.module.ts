import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { EmailModule } from '../email/email.module.js';
import {
  TOKEN_ENV,
  loadTokenEnvironment,
} from './token-environment.js';
import { TOKEN_POOL, TokenService } from './token.service.js';

export const TOKEN_POOL_MAX = 5;

/**
 * Module-evaluation-time assertion of the token environment.
 * A process with missing or invalid token secrets refuses to boot before
 * Nest constructs any providers or routes.
 */
export const APP_TOKEN_ENVIRONMENT = loadTokenEnvironment(process.env);

@Module({
  imports: [ConfigModule, EmailModule],
  providers: [
    {
      provide: TOKEN_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const env = config.getOrThrow<Environment>('environment');
        return new Pool({
          host: env.database.host,
          port: env.database.port,
          user: env.authenticator.user,
          password: env.authenticator.password,
          database: env.database.database,
          max: TOKEN_POOL_MAX,
        });
      },
    },
    { provide: TOKEN_ENV, useValue: APP_TOKEN_ENVIRONMENT },
    TokenService,
  ],
  exports: [TokenService, TOKEN_ENV],
})
export class TokenModule {}
