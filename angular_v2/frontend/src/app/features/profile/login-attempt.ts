import type { components } from '../../api/schema';

/**
 * One of the member's own sign-in attempts.
 *
 * The same six columns as `login_attempts` — generated from the live catalog, not
 * hand-written — because `GET /api/users/me/login-attempts` returns the attempt
 * rows for the caller's own username and nothing else.
 *
 * ## `username` is not in this Pick, and that is deliberate
 *
 * The `login_attempts` table has NO `user_id` column. It is deliberately text,
 * because an attempt against a username that does not exist still has to be
 * recorded: a brute-force sweep names accounts that are not there, and a row that
 * could only be written for a real account would leave the sweep invisible. So the
 * history is matched by `username`, and the page cannot show the column because
 * the column is not in the response — it would be the member's own username
 * repeated on every row, saying nothing.
 *
 * `username` is also immutable (`0008_user_identity.sql`), which is what stops this
 * from fragmenting: attempts recorded under the username someone signed in with are
 * still theirs after a rename. That reasoning is invisible in a column list, so it
 * is recorded where the shape is declared.
 *
 * `ip` and `ip_subnet` are both present and are shown together on purpose: the
 * subnet is the aggregated form the reputation counters key on
 * (`ip_normalized` → `ip_subnet`), so an operator reading the page can tell a
 * single host from a crowd behind one address.
 */
export type ProfileLoginAttempt = Pick<
  components['schemas']['login_attempts'],
  'id' | 'ip' | 'status' | 'attempt_kind' | 'created_at' | 'ip_subnet'
>;