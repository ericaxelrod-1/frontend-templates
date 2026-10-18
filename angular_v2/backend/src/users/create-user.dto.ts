import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { NAME_MAX_LENGTH, NewPassword } from '../common/password-policy.js';
import { MAX_PENDING_EMAIL_LENGTH } from '../token/email-change-token.js';

/**
 * `POST /api/users` — an administrator creates an account.
 *
 * ## WHY `role` AND `group` ARE HERE, AND WHY THEY ARE REQUIRED
 *
 * §B2's invariant is "every user has at least one role and at least one group". This body
 * used to be five fields and could not satisfy it: `UsersService.createUser` made the row,
 * logged a `warn` about what was missing, and answered `201` — and the new account then
 * signed in and read **zero rows** for `GET /users/me`, because `users_read_scope` needs
 * `authz.can_read_user()` and that is false with no `user_roles` row. §2.1 calls a
 * success-shaped report for work that did not happen worse than absence.
 *
 * So the caller is asked. Both are REQUIRED and neither is defaulted, because a role is
 * CAPABILITY and a group is SCOPE, and a route whose job is to make a row has no business
 * choosing either — an account that silently holds `admin` is a worse outcome than an
 * account that cannot read its own profile, which is the trade the previous version of this
 * route made deliberately and correctly.
 *
 * The cost the brief names — "the create form must offer them" — is a form's problem on a
 * route only `app_admin` may call, and an administrator who cannot say which role an account
 * should hold is not yet the administrator who should be creating it. Read
 * `users.service.ts` §§B2's invariant is honoured here for the full argument, including why
 * the invariant cannot be enforced by a database constraint in this schema: `user_roles` and
 * `user_groups` are `REFERENCES users (id)`, so the membership rows cannot be written before
 * the row they name, and the only remaining shape is a deferred trigger that would refuse the
 * COMMIT of an ordinary two-statement autocommit provisioning.
 *
 * They are NAMES, not ids. A uuid makes the failure silent — `23503` from the foreign key,
 * which names a constraint rather than a mistake — where a name answers "there is no role
 * named 'boss'". The database lookup is the validation; there is no closed vocabulary here,
 * and inventing one would make this the only route in the tree with a role-name rule.
 *
 * ## `username` IS `@Matches`'d AND IMMUTABLE, WHICH ARE TWO DIFFERENT FACTS
 *
 * The pattern is a sanity bound so an operator cannot create an account whose login name is a
 * newline or a NUL — the same reason `EmailService.send` refuses a recipient that is not a
 * single-line address before it reaches a header parser. It is not a policy about what a
 * username may contain: §B2 has no such vocabulary and inventing one here would make this
 * endpoint the only route with a name rule.
 *
 * The column is `text NOT NULL UNIQUE` (`0002:31`). `UNIQUE` is why a duplicate username is
 * a `422`; see `users.service.ts`.
 */
export class CreateUserDto {
  @ApiProperty({
    description: 'Login name. UNIQUE in the schema, and immutable once set (a BEFORE trigger refuses a rename).',
    example: 'jane.doe',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message:
      'username must start with a letter or digit and may then contain letters, digits, dot, underscore and hyphen',
  })
  @MaxLength(NAME_MAX_LENGTH)
  username: string;

  @ApiProperty({
    description:
      'The address on file. NOT UNIQUE in the schema, so a duplicate is allowed here — see the class comment in users.service.ts.',
    example: 'jane.doe@example.test',
  })
  @IsEmail()
  @MaxLength(MAX_PENDING_EMAIL_LENGTH)
  email: string;

  @ApiProperty({
    description: 'The password to set. Same rule and same bcrypt cost as every other path that sets one.',
    writeOnly: true,
  })
  @NewPassword()
  password: string;

  @ApiProperty({
    description:
      'The role this account will hold, by name. Required, because §B2 says every user has at least one role and a ' +
      'row with none can read nothing — not even its own profile. An unknown name is a 422 naming it, checked ' +
      'against the live `roles` table before any row is written.',
    example: 'member',
  })
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  role: string;

  @ApiProperty({
    description:
      'The group this account will belong to, by name. Required for the same reason `role` is: without a ' +
      'membership row the account has no scope, and §B2 says every user has at least one group. A user may hold ' +
      'several; this route creates the first one and the rest are added by an operator.',
    example: 'EU',
  })
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  group: string;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'Given name. Omit or send null to leave it unstated; blank is refused by the database.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  first_name?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'Family name. Omit or send null to leave it unstated; blank is refused by the database.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX_LENGTH)
  last_name?: string | null;
}
