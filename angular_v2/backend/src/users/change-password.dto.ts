import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { NewPassword, NEW_PASSWORD_MAX_LENGTH } from '../common/password-policy.js';

/**
 * `POST /api/users/me/password` — prove the current one, choose the next.
 *
 * ## WHY BOTH FIELDS, AND WHY THE ROUTE IS NOT A RESET
 *
 * A password change that did not prove the current one **is** a reset, and a reset
 * belongs on a route that sends a token to a channel the account holder controls.
 * This route is reached with a session, so the session plus the current password is
 * the whole of the authentication the change asks for — and asking for less would put
 * a second, weaker path to a new password on an endpoint that already knows who the
 * caller is.
 *
 * ## THE WIRE NAMES ARE snake_case, NOT camelCase
 *
 * `current_password` and `new_password`, matching the columns and the wire end to end
 * (AGENTS.md §B1) and the frontend's hand-written mirror
 * (`features/profile/password-change-request.ts`). There is **no client key
 * transform** — §B1 forbids one outright, because it rewrites keys inside `jsonb` and
 * corrupts passthrough payloads — so the DTO's property names ARE the wire names.
 *
 * ## `new_password` IS `@NewPassword()`, THE SAME RULE THE RESET PATH USES
 *
 * Read from `src/common/password-policy.ts` rather than restated, so the two routes
 * that set a password cannot drift apart: a 2000-character password accepted here and
 * refused by the reset route is a support ticket, and both answers are "success", so
 * the drift is invisible to anything except a member who hits it.
 *
 * `current_password` carries `@MaxLength(1024)` and nothing else. **It has no minimum
 * on purpose.** A `MinLength(1)` would turn "you sent an empty string" into a `400`
 * that is distinguishable from "your current password is wrong" (`422`), and this is
 * exactly the failure mode the whole `422`-not-`401` decision on this route exists to
 * avoid: two outcomes for one mistake, on a route whose response IS the feedback. An
 * empty string goes to bcrypt and is answered as the credential failure it is.
 */
export class ChangePasswordDto {
  @ApiProperty({
    description:
      'The password on file now. A mismatch is answered 422 — never 401, which this application reserves for a refused token.',
    writeOnly: true,
  })
  @IsString()
  @MaxLength(NEW_PASSWORD_MAX_LENGTH)
  current_password: string;

  @ApiProperty({
    description: 'The password that replaces it. Same rule as the reset path; hashed at the same bcrypt cost.',
    writeOnly: true,
  })
  @NewPassword()
  new_password: string;
}
