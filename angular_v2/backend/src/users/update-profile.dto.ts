import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { NAME_MAX_LENGTH } from '../common/password-policy.js';

/**
 * `PATCH /api/users/me` — the two columns a member may write for themselves.
 *
 * ## WHY THE LIST IS TWO COLUMNS AND NOT FOUR
 *
 *   * `username` is absent because it is **immutable**: `authz.guard_username_immutable`
 *     (`0023:382-420`) raises `55000` on any rename that is not the erasure rewrite,
 *     and the frontend's `profile-update-request.ts` says the same. Offering the field
 *     would produce a `500` from the database for a value the member believes they
 *     set.
 *   * `email` is absent because it has its own **two-phase** route. A `PATCH` that set
 *     it would be the account-takeover primitive this feature exists to refuse — see
 *     `users.service.ts` §The address change is two phases.
 *   * `id` is absent because a caller does not name its own key; it comes from the
 *     verified token and from nowhere else.
 *   * `created_at`, the `geo_*` columns and everything else are absent because they
 *     are not the member's to write.
 *
 * The global `ValidationPipe` is `{ whitelist: true, forbidNonWhitelisted: true }`, so
 * a body carrying any of the above is refused with a `400` naming it — which is the
 * answer a client wants, rather than a silent no-op.
 *
 * ## `null` CLEARS A NAME AND `''` DOES NOT, AND THE DIFFERENCE IS NOT OURS TO INVENT
 *
 * Both columns are nullable (`0023:78-79`), and `NULL` is the schema's own word for
 * "nobody has stated a name" — so `null` is accepted and writes `NULL`.
 *
 * `''` is a different thing entirely and is refused by `users_first_name_not_blank` /
 * `users_last_name_not_blank` (`0023:216-251`), which reject `''`, `' '` and `'CA '`
 * together. `UsersService.updateMe` maps that database refusal to a `422` rather than
 * letting it be a `500`, because "your name may not be blank" is a validation answer
 * and not a server fault. The frontend's `profile-update-request.ts` documents the same
 * split from the other side: "clearing a name is `''` being rejected by
 * `users_first_name_not_blank`, not the column being absent".
 *
 * **Both fields are optional, and a body carrying neither is refused** with a `422`
 * rather than answered `200` with an unchanged row — a `PATCH` that changed nothing is
 * a caller mistake worth naming, and answering it `200` would report a success for a
 * write that did not happen.
 */
export class UpdateProfileDto {
  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'Given name. `null` clears it; a blank or whitespace-only value is refused by the database.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  first_name?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'Family name. `null` clears it; a blank or whitespace-only value is refused by the database.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  last_name?: string | null;
}
