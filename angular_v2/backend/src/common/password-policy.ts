import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The one rule for "is this string acceptable as somebody's new password", and the
 * place three routes read it from.
 *
 * ## WHAT THE RULE IS, AND WHY IT IS ONLY THESE TWO BOUNDS
 *
 * `PasswordResetConfirmDto` documented for a long time that this repository has no
 * password policy anywhere — not at sign-in, not at reset, not in `security.md` — and
 * that introducing one on the reset path alone "would make a weak password *harder* to
 * set by forgetting than to set by attacking", which is a policy with no matching rule
 * on the path that actually sets most passwords. That argument is unchanged; what has
 * changed is that a THIRD path now sets a password (`POST /users/me/password`), so the
 * "one place all the paths read" that the comment said did not exist yet has to exist
 * before this decorator is written rather than after.
 *
 * So the rule is still `@IsString()`, a minimum of 1 and a maximum of 1024 — the
 * exact bounds `LoginRequestDto` and `PasswordResetConfirmDto` already used, so this
 * change **moves** the numbers rather than inventing any. The `@MaxLength` is not
 * decoration: bcrypt considers only the first 72 bytes, so anything past it is
 * discarded, and a reason to reject is a better answer than a reason to truncate
 * silently.
 *
 * ## WHY IT IS A DECORATOR AND NOT THREE LITERALS
 *
 * `BCRYPT_COST` is the same argument about the same class of drift: a value repeated
 * in three files is one correct copy and two drifted copies, and the drifted ones are
 * the ones nobody re-reads. Here the drift is not a timing oracle but a *policy*
 * split-brain — a route that lets a 2000-character password through beside one that
 * refuses it is a support ticket, and the difference is invisible because both
 * answers are "success". Composing the decorators means a future policy change is one
 * edit in this file rather than three edits that have to be remembered together.
 *
 * `@ApiProperty()` is NOT composed here. AGENTS.md §B3 requires it on every DTO field
 * and the Swagger CLI plugin reads it from the class, so each field still declares it
 * where the field is declared.
 */
export const NEW_PASSWORD_MIN_LENGTH = 1;

/**
 * 1024, matching `LoginRequestDto`'s. Not a number anybody chose as "the right
 * length": it is the same number, so that the three routes cannot disagree about what
 * a password is, and bcrypt's 72-byte truncation is the reason it exists at all.
 */
export const NEW_PASSWORD_MAX_LENGTH = 1024;

/**
 * Every validator a value that will BE somebody's password has to satisfy.
 *
 * Applied at the DTO boundary only. Nothing downstream re-checks it: the hash is taken
 * from a value that passed here, and the reset/change/create routes all funnel
 * through `bcrypt.hash(value, BCRYPT_COST)` with no second opinion.
 */
export function NewPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(NEW_PASSWORD_MIN_LENGTH),
    MaxLength(NEW_PASSWORD_MAX_LENGTH),
  );
}

/**
 * The longest a person's name may be, for `first_name` and `last_name`.
 *
 * Both columns are `text` and unbounded (`0023`), and a bound is still the right
 * answer: an unbounded display field is a payload the member's own profile page has to
 * render, and `TokenRequestDto` already sets the precedent this number follows — "255
 * matches `users.username`'s column width, and an address longer than this is not an
 * address". A name longer than `users.username` is not a name either.
 *
 * **The blank rule is NOT here.** `''`, `' '` and `'CA '` are refused by
 * `users_first_name_not_blank` / `users_last_name_not_blank` (`0023:216-251`), and the
 * write route maps that `23514` to a `422`. Adding a `MinLength(1)` would duplicate a
 * rule the database already enforces, in a second place, with a second answer — and
 * the two would disagree about `' '`, which is exactly the case the CHECK exists for.
 */
export const NAME_MAX_LENGTH = 255;
