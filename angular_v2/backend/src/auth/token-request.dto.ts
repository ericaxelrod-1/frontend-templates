import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * `POST /auth/password-reset/request`, and the identical body for
 * `POST /auth/email-verification/request`.
 *
 * One shape for both, because the property that matters here is that the two
 * routes cannot drift: an address-validation rule accepted on one and rejected on
 * the other would make "which form does this endpoint accept?" an existence
 * oracle on a route whose entire purpose is not having one.
 *
 * **`@IsEmail` is the only reason this request can answer 400.** A malformed
 * address is refused before the gate, the counter and the database are touched.
 * That is a statement about the *format* of the input and carries no information
 * about whether the address is registered — every registered address is a valid
 * one — so the 400 does not weaken the enumeration property the response body
 * carries. Refusing garbage is required; refusing garbage *silently* is not.
 *
 * `@MaxLength(255)` matches `users.username`'s column width, and an address
 * longer than this is not an address.
 */
export class TokenRequestDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  email: string;
}