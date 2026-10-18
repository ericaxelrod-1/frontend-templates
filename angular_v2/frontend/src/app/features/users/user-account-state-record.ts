/**
 * The erasure record and the disable state of one `users` row — the seven
 * columns that say what has been done TO an account, as opposed to what the
 * account says about itself.
 *
 * They are admin-only, and `users-page` passes `blocked` alongside this record
 * rather than passing a partial one, because "this account was never disabled" and
 * "this column is not readable for your role" are different facts and must not
 * render the same cell.
 */
export interface UserAccountStateRecord {
  readonly deletedAt: string | null;
  readonly deletionReason: string | null;
  readonly emailAnonymized: boolean | null;
  readonly disabledAt: string | null;
  readonly disabledBy: string | null;
  readonly disabledReason: string | null;
  readonly disabledUntil: string | null;
}