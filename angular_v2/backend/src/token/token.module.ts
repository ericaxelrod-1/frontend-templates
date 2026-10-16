import { Module } from '@nestjs/common';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { EmailModule } from '../email/email.module.js';
import { TOKEN_ENV, loadTokenEnvironment } from './token-environment.js';
import { TokenService } from './token.service.js';

/**
 * Module-evaluation-time assertion of the token environment.
 * A process with missing or invalid token secrets refuses to boot before
 * Nest constructs any providers or routes.
 */
export const APP_TOKEN_ENVIRONMENT = loadTokenEnvironment(process.env);

/**
 * The shared one-time token primitive (mint, store, deliver, redeem, expire) with no
 * HTTP routes mounted directly, and the ONE pool every database-touching service in
 * the process uses — `SharedDatabasePool`, imported from
 * `common/database-pool.module.ts`. This module used to build a fifth `pg.Pool` with
 * `max: 5`; a pool has one `max`, so the process-wide budget is now a single readable
 * number (`common/database-pool.ts` §What is lost).
 */
@Module({
  imports: [EmailModule, DatabasePoolModule],
  providers: [{ provide: TOKEN_ENV, useValue: APP_TOKEN_ENVIRONMENT }, TokenService],
  exports: [TokenService, TOKEN_ENV],
})
export class TokenModule {}