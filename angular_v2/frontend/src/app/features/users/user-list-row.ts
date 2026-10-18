import type { UserAccountStateRecord } from './user-account-state-record';

/**
 * One row of the Users table: a `users` row as the page consumes it, plus the two
 * associations resolved to names by `UsersApi`.
 *
 * ## Every generated column except `password_hash`, normalised
 *
 * The field names are camelCase because a template that writes `row.deletedAt`
 * next to `row.createdAt` reads as one vocabulary, and — the reason that matters
 * more — because AGENTS.md §B1 fixes snake_case to the WIRE: the rename happens
 * once, in the `computed` in `users-page.ts`, and nowhere else.
 *
 * `password_hash` has no field here and cannot grow one. It is a credential
 * artifact, not data about a user, and `UsersApi` never asks for it — see
 * `users-api.service.ts`, where the row type is `keyof & not 'password_hash'`, so
 * adding a hash field to this interface is a type error rather than a review
 * question.
 *
 * ## `null` means "the database has no value here"
 *
 * Every field is `T | null` rather than `T | undefined` because the two absences
 * the page must keep apart are "the column is NULL" and "the column was not
 * readable for this role", and `undefined` is used for the second one in the
 * service's row type. Normalising at this boundary means a template never has to
 * know which absence it is looking at — the page decides from the column scope it
 * sent, not from whether a key happens to be there.
 */
export interface UserListRow extends UserAccountStateRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly createdAt: string;

  readonly firstName: string | null;
  readonly lastName: string | null;

  /**
   * When this account last passed a CREDENTIAL check, and when the application
   * last OBSERVED any activity for it.
   *
   * They are kept as two fields and never merged, because they answer two different
   * questions and NULL means something different in each: a NULL `last_login_at` is
   * "no successful authentication has ever been recorded", which is NOT the same
   * as "never signed in"; a NULL `last_activity_at` is "never observed", and
   * `authz.retention_due_accounts` requires `IS NOT NULL` precisely because a
   * measurement that was never taken cannot show that an account is dormant
   * (0017 §1). An interface with one `lastSeen` field would make both NULLs say
   * the same thing.
   */
  readonly lastLoginAt: string | null;
  readonly lastActivityAt: string | null;

  /** A timestamp, not a boolean: NULL is "not verified", a value is "verified then". */
  readonly emailVerifiedAt: string | null;

  readonly countryCode: string | null;
  readonly regionCode: string | null;
  readonly city: string | null;
  readonly geoSource: string | null;
  readonly geoAccuracyKm: number | null;
  readonly geoUpdatedAt: string | null;

  readonly roleNames: readonly string[];
  readonly groupNames: readonly string[];
}