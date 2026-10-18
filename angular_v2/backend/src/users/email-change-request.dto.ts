import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';
import { MAX_PENDING_EMAIL_LENGTH } from '../token/email-change-token.js';

/**
 * `POST /api/users/me/email` — the address the member wants NEXT.
 *
 * ## THERE IS ONE FIELD, AND WHAT IS ABSENT IS THE DESIGN
 *
 * No `current_password`, because this route must not be reachable by anything that
 * has only a stolen session — and if it asked for the current password it would be
 * indistinguishable, from the outside, from `POST /users/me/password`.
 *
 * No `current_email`, because **nothing about the current address changes here.** The
 * address on file stays in force until the link is redeemed, so "the address I am
 * replacing" is not an input to this request at all; asking for it would invite a
 * client to render it as part of the change.
 *
 * No `username` or `user_id`, because the member is the verified token's `sub` and
 * nothing else can say who they are.
 *
 * ## `@MaxLength` IS THE TOKEN'S, NOT THE COLUMN'S
 *
 * `255` is `MAX_PENDING_EMAIL_LENGTH`, the same bound
 * `src/token/email-change-token.ts` uses to size the composite token. The two are the
 * same number on purpose: the address is carried INSIDE the one-time token, so an
 * unbounded address is an unbounded URL in a mail client. `TokenRequestDto` sets the
 * same precedent for the same reasoning — "an address longer than this is not an
 * address".
 *
 * `@IsEmail` is the only reason this route can answer `400`, and the refusal is a
 * statement about the FORMAT of the input, carrying nothing about any account — the
 * caller is already authenticated and already knows who they are, so there is no
 * enumeration argument on this route to weaken.
 */
export class EmailChangeRequestDto {
  @ApiProperty({
    description: 'The address to move the account to, once this link is opened from that mailbox.',
    example: 'new-address@example.test',
  })
  @IsEmail()
  @MaxLength(MAX_PENDING_EMAIL_LENGTH)
  email: string;
}
