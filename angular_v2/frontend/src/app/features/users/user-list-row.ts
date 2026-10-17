/**
 * One row of the Users table: a `users` row plus the two associations resolved to
 * names by `UsersApi`.
 *
 * The names are arrays rather than ids so the template can render them without
 * a lookup, and empty when the association is not readable for the signed-in
 * role — which is a different statement from "no roles", and the page renders the
 * difference.
 */
export interface UserListRow {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly createdAt: string;
  readonly roleNames: readonly string[];
  readonly groupNames: readonly string[];
}