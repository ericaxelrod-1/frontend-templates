import { ApiProperty } from '@nestjs/swagger';

/**
 * The response to a successful address verification.
 *
 * **It reports the fact and not the permission.** `verified` is a statement about
 * a column in `users`, and this is worth being explicit about because the obvious
 * next step is to add `andYouMayNowSignIn` — which would be a lie twice over:
 * `AuthService.issueSession` gates on the password and on nothing else, so an
 * address being verified changes no capability any account has today. A response
 * claiming otherwise would teach a client to expect a gate that does not exist.
 *
 * @see database/migrations/0020_users_email_verified_at.sql for why the stamp is
 *   data and is read by nothing in this tree.
 */
export class EmailVerificationConfirmedDto {
  @ApiProperty({ description: '`verified` on success; a failed redemption is a 400, never this body.' })
  status: 'verified';
}