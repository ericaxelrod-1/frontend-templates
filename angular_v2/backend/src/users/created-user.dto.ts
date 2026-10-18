import { ApiProperty } from '@nestjs/swagger';

/**
 * The `201` from `POST /api/users`.
 *
 * Six fields: the key, the login name, the address, the two names and when the row was
 * created. **Not the twelve of `UserProfileDto`, and that difference is deliberate.**
 *
 * This route creates the row; `GET /api/users/me` is the caller's own row within their
 * column grant. The two answer different questions and a client that reused one shape
 * for both would be asserting that "the account an administrator just made" and "the
 * account you are" are the same thing — which for a newly created account they are not,
 * because the creator is not it.
 *
 * ## `created_at` IS THE DATABASE'S, NOT THE CALLER'S
 *
 * The column is `timestamptz NOT NULL DEFAULT now()` (`0002:34`) and the insert does
 * not name it, so the value comes back from the `RETURNING` clause of the statement that
 * wrote the row. An operator cannot backdate an account they just created, and the
 * response cannot report a timestamp the database did not write.
 *
 * ## `email_verified_at` IS ABSENT AND ITS ABSENCE IS NOT AN OVERSIGHT
 *
 * Nothing verified this address. It was typed by an administrator, not proven by anyone
 * opening a link out of the mailbox, so the column stays `NULL` and is admin-only in any
 * case (`0023:604-628`). Reporting a "created" flag would be reporting something nobody
 * established.
 */
export class CreatedUserDto {
  @ApiProperty({ format: 'uuid', description: 'The new `users.id`, from the column default.' })
  id: string;

  @ApiProperty({ description: 'The login name that was created.' })
  username: string;

  @ApiProperty({ description: 'The address on file. Nothing has verified it yet.' })
  email: string;

  @ApiProperty({ nullable: true, description: 'Given name, or NULL when none was supplied.' })
  first_name: string | null;

  @ApiProperty({ nullable: true, description: 'Family name, or NULL when none was supplied.' })
  last_name: string | null;

  @ApiProperty({ description: 'When the row was written, from the database clock.' })
  created_at: string;
}
