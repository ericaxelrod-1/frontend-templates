import { ApiProperty } from '@nestjs/swagger';

/**
 * The response to a successful password reset.
 *
 * **No session is issued here, and that is a decision rather than an omission.**
 * Handing back an access and refresh token from the reset path would be the
 * shortest route to a working session that never passed `login` — so it would skip
 * the brute-force gate, skip `recordActivity`'s sibling audit row, and skip every
 * other thing `issueSession` does because it is the only issuer of sessions in this
 * tree (§2.4: one mechanism per concern). The caller logs in with the password it
 * just chose, through the route that is supposed to be audited.
 *
 * The status word says what was done and no more. It does not name the account,
 * and there is nothing here a caller could use to learn anything they did not
 * already know by choosing the new password.
 */
export class PasswordResetConfirmedDto {
  @ApiProperty({ description: '`password_reset` on success; a failed redemption is a 400, never this body.' })
  status: 'password_reset';
}