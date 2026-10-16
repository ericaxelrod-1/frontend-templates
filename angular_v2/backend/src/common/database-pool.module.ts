import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SharedDatabasePool } from './database-pool.js';

/**
 * The one pool, exported so every feature that writes to the database imports this
 * module rather than building its own (`AGENTS.md` §2.4).
 *
 * A module rather than a `@Global()` provider for the reason `email.module.ts` gives:
 * a module that is imported explicitly by the features that need it is easier to read
 * than one every feature can reach, and the import list is the evidence that a
 * consumer was migrated rather than silently left behind.
 *
 * The pool's shutdown lives with the pool — which is the other half of the
 * consolidation. Previously `AuthService` and `EmailService` each ended a pool
 * nobody else knew about, and the retention, erasure and token pools were never ended
 * at all; one owner ends one pool, and `pg.Pool` holds its idle sockets open enough
 * to keep a process alive, so an un-ended pool is a process that does not exit
 * cleanly.
 */
@Module({
  imports: [ConfigModule],
  providers: [SharedDatabasePool],
  exports: [SharedDatabasePool],
})
export class DatabasePoolModule {}