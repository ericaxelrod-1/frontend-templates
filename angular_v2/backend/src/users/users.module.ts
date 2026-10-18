import { Module } from '@nestjs/common';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { EmailModule } from '../email/email.module.js';
import { PostgrestModule } from '../postgrest/postgrest.module.js';
import { TokenModule } from '../token/token.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * The member's own profile endpoints, and the administrator's user creation.
 *
 * ## FOUR IMPORTS, AND EACH ONE IS A DEPENDENCY THIS FEATURE ACTUALLY HAS
 *
 *   * **`DatabasePoolModule`** — `SharedDatabasePool`, the ONE pool this process has
 *     (`common/database-pool.ts`). Every privileged statement runs on it inside
 *     `BEGIN` → `SET LOCAL ROLE app_admin` → work → `COMMIT`, which is the escalation
 *     boundary the seed uses and the one `AuthService` documents.
 *   * **`PostgrestModule`** — `PostgrestClient`, the identity seam. `GET /users/me` is
 *     the one read in this feature that goes through it, because it is the one read that
 *     must be answered with the CALLER's privileges rather than with a claimless admin
 *     session: the column grant and `users_read_scope` have to see who is asking, and
 *     the only mechanism that lets them is PostgREST verifying the caller's own token.
 *   * **`TokenModule`** — `TokenService`, the shared one-time-token primitive. The address
 *     change mints, supersedes and redeems through it, so there is no second token
 *     machinery anywhere in this feature and the two-phase flow inherits the primitive's
 *     single-use, expiry and purpose separation rather than re-implementing them.
 *   * **`EmailModule`** — `EmailService`, the one configured provider. The address-change
 *     link goes out through the same path as the reset and verification links, so
 *     `email_messages` records all three identically and there is one place that decides
 *     a credential-bearing body is not persisted.
 *
 * Nothing else is imported, and that is the §B7 discipline rather than an accident: no
 * compatibility re-export, no second `AuthService`, and no service here that another
 * feature would have to reach into.
 */
@Module({
  imports: [DatabasePoolModule, PostgrestModule, TokenModule, EmailModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
