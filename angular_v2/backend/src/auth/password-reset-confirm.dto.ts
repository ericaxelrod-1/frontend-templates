import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

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
 * in `test/unit/auth/reset-confirm.spec.ts`.
 *
 * ## No password policy is invented here
 *
 * `@MinLength(1)` mirrors `LoginRequestDto` exactly, deliberately. This repository
 * has no password-length rule anywhere — not at registration (there is no
 * registration route), not at login, not in `security.md` — so introducing one on
 * the reset path alone would make a weak password *harder* to set by forgetting
 * than to set by attacking, and would be a policy with no matching rule on the
 * path that actually sets most passwords. A policy belongs in one place that all
 * three paths read; that place does not exist yet, and building it is not this
 * change.
 *
 * `@MaxLength(1024)` matches `LoginRequestDto`. bcrypt considers only the first
 * 72 bytes, so anything past that is discarded — which is a reason to reject
 * rather than truncate silently, and a reason to reject at 1024 rather than
 * somewhere further out.
 */
export class PasswordResetConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password: string;
}