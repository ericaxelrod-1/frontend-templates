import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { NAME_MAX_LENGTH, NewPassword } from '../common/password-policy.js';
import { MAX_PENDING_EMAIL_LENGTH } from '../token/email-change-token.js';

/**
 * `POST /api/users` — an administrator creates an account.
 *
 * ## WHY THERE IS NO `role` AND NO `group` HERE
 *
 * §B2's invariant is "every user has at least one role and at least one group", and this
 * body cannot satisfy it: the contract for this route carries five fields and a client
 * that sends them expects a `201`, not a `422` about an authority it was never offered a
 * way to supply. So the endpoint creates the row and leaves it **visibly incomplete** —
 * `UsersService.createUser` logs at `warn` what is missing and what would fill it, and
 * `test/e2e/profile.e2e-spec.ts` asserts the row really has neither. It does not invent
 * a role assignment nobody asked for, because an account silently holding `admin` is a
 * worse outcome than an account that cannot read its own profile.
 *
 * Read `users.service.ts` §The created account has no role and no group for what a
 * caller can and cannot do with it as it stands.
 *
 * ## `username` IS `@Matches`'d AND IMMUTABLE, WHICH ARE TWO DIFFERENT FACTS
 *
 * The pattern is a sanity bound so an operator cannot create an account whose login name
 * is a newline or a NUL — the same reason `EmailService.send` refuses a recipient that
 * is not a single-line address before it reaches a header parser. It is not a policy
 * about what a username may contain: §B2 has no such vocabulary and inventing one here
 * would make this endpoint the only route with a name rule.
 *
 * The column is `text NOT NULL UNIQUE` (`0002:31`). `UNIQUE` is why a duplicate username
 * is a `422`; see `users.service.ts`.
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
