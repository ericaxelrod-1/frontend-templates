import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { NewPassword } from '../common/password-policy.js';

/**
 * `POST /auth/password-reset/confirm` — the token from the mail and the password
 * that replaces the current one.
 *
 * ## The bounds are the token primitive's, not this route's
 *
 * `16 … 256` is exactly the window `TokenService.redeem` refuses outside, where
 * the early return is preceded by a constant-time dummy comparison so the refusal
 * costs what a real comparison costs. A `MinLength` here therefore saves nothing
 * except the round trip, and **the two must not drift**: a DTO that accepted a
 * 4-character token would let it reach `redeem`, which handles it correctly —
 * while a DTO that *rejected* a valid 43-character base64url token at 400 would
 * turn a uniform "that link is no good" into a distinguishable outcome for a
 * malformed-only caller. The bounds are asserted from the primitive's own constant
 * in `test/unit/auth/token-routes.spec.ts`.
 *
 * ## The password field is `@NewPassword()`, and that is a MOVE rather than a NEW RULE
 *
 * This DTO used to spell `@IsString() @MinLength(1) @MaxLength(1024)` itself, and its
 * own comment said the rule belonged "in one place that all the paths read; that place
 * does not exist yet, and building it is not this change". Two routes now set a
 * password — this one and `POST /users/me/password` — so the place exists and this
 * field reads from it. The numbers are unchanged; see `src/common/password-policy.ts`
 * for why they are what they are and why that is still not a policy in the
 * "must contain a digit" sense.
 */
export class PasswordResetConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token: string;

  @ApiProperty()
  @NewPassword()
  password: string;
}