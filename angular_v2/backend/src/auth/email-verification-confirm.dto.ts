import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /auth/email-verification/confirm` — the token from the verification mail,
 * and nothing else.
 *
 * **There is no second field, and that is the whole design.** A verification is a
 * claim ("this person controls this mailbox") with nothing to supply and nothing
 * to choose, so a body that accepted one would be inventing a decision the
 * primitive does not make. The bounds are the primitive's own redemption window —
 * see `PasswordResetConfirmDto` for why they match `TokenService.redeem` exactly
 * rather than approximately.
 */
export class EmailVerificationConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token: string;
}