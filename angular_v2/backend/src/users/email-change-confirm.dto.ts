import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { EMAIL_CHANGE_TOKEN_MAX_LENGTH } from '../token/email-change-token.js';

/**
 * `POST /api/users/me/email/confirm` — the token from the address-change mail, and
 * nothing else.
 *
 * ## THERE IS NO `email` FIELD, AND IT IS NOT AN OMISSION
 *
 * The address is already inside the token, and it is inside the part
 * `TokenService.hashToken` HMACs. A body that also accepted an address would be a
 * second, unauthenticated copy of the value the token commits to — and the copy would
 * be the one a reader assumes is checked. There is nothing to supply: the link either
 * carries an address or it is not one of our links.
 *
 * ## THE BOUNDS ARE THE COMPOSITE TOKEN'S, AND THEY ARE NOT THE OTHER CONFIRM DTO's
 *
 * `16 … 256` is the window `TokenService.redeem` applies to a **bare** token, and a
 * composite token is a different shape with a different ceiling — it carries a
 * base64url payload, so a 255-byte address is roughly 388 characters. Reusing `256`
 * here would 400 a perfectly good link, and — the part that actually matters — it
 * would do so on the basis of the address's length, which is one more thing the answer
 * varies with.
 *
 * ## THE CEILING IS HERE AND THE FLOOR IS NOT, AND THE ASYMMETRY IS THE POINT
 *
 * The ceiling is `EMAIL_CHANGE_TOKEN_MAX_LENGTH`, imported from the codec that also
 * enforces it, and it is here for one reason: a body that carries an enormous string
 * is a malformed body, and `400` is the right answer for that.
 *
 * The FLOOR is deliberately absent, and its absence is a fix rather than an
 * oversight. `@MinLength(EMAIL_CHANGE_TOKEN_MIN_LENGTH)` made a **well-formed token
 * of the WRONG KIND** look like a malformed request: a bare email-verification token
 * is shorter than the shortest composite email-change token, so the DTO refused it
 * with `400` before the codec was ever consulted — while the codec answers `422` for
 * a token it cannot use. Two answers for one mistake, which is the thing
 * `PasswordResetConfirmDto` exists to avoid and the thing this route was doing.
 *
 * The lower end is therefore the primitive's business, exactly as the upper end is
 * the primitive's business; what the DTO keeps is a body-size bound. A token that is
 * too short, too long, of the wrong kind, or of the right kind and already spent
 * now gets ONE answer from the codec, and that answer is `422`.
 */
export class EmailChangeConfirmDto {
  @ApiProperty({
    description:
      'The token from the address-change mail. Carries the pending address inside it; nothing else is supplied.',
  })
  @IsString()
  @MaxLength(EMAIL_CHANGE_TOKEN_MAX_LENGTH)
  token: string;
}
