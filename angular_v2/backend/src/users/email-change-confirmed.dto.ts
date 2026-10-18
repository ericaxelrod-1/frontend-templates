import { ApiProperty } from '@nestjs/swagger';

/**
 * The `200` from `POST /api/users/me/email/confirm`.
 *
 * **It reports the fact and not the permission, exactly as
 * `EmailVerificationConfirmedDto` does.** `email_changed` is a statement about a
 * column and about which mailbox answered for it. It does not say the new address is
 * "verified" in any richer sense, and it does not say anything about what the member
 * may now do — which is nothing new, because every capability in this schema is
 * resolved from `user_roles` and this route writes no role.
 *
 * `email_verified_at` WAS set, and it is worth saying why that is the same instant:
 * opening the link out of the new mailbox IS the proof that the member controls it.
 * The old address's stamp does not carry over — it described a mailbox that is no
 * longer the one mail goes to, so keeping it would record a verified fact about the
 * wrong address.
 *
 * @see `email-change-confirm.dto.ts` for why this body cannot be used to learn the
 *   address it moved the account to.
 */
export class EmailChangeConfirmedDto {
  @ApiProperty({
    description: '`email_changed` on success; a failed redemption is a 400, never this body.',
  })
  status: 'email_changed';
}
