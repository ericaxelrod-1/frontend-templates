import type { components } from '../../api/schema';

/**
 * The member's own row: exactly the twelve columns `app_member` is granted on
 * `users`.
 *
 * ## This Pick IS the column grant, and it must not grow a key
 *
 * `0023_user_profile_and_disable.sql` grants
 *
 *     SELECT (id, username, email, created_at,
 *             country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at,
 *             first_name, last_name) ON public.users TO app_member;
 *
 * and the `users` read on a member's behalf goes through `GET /api/users/me`. Two
 * consequences, and the second is the one that bites:
 *
 * 1. Everything a member may know about their own account is here. Nothing else in
 *    `users` is theirs to see.
 * 2. **Adding a key to this `Pick` does not add a column to the page — it breaks
 *    the page.** The DTO behind that route is built from the same grant, so a
 *    `Pick` that reaches for `last_login_at` is a request the thin app cannot
 *    answer, or one that answers `403` for the whole call. That is why
 *    `last_login_at`, `last_activity_at`, `email_verified_at`, `disabled_*` and
 *    `deleted_at` are absent here and why the profile page says so out loud rather
 *    than omitting them silently: the member genuinely cannot see whether their
 *    address is verified, and pretending otherwise with a locally-derived "verified"
 *    flag would be a claim this response cannot support.
 *
 * There is no runtime validation of the shape here because there is nothing to
 * validate: these are compile-time types derived from a document generated from the
 * live catalog, and a column rename is caught by `npm run generate:client` plus
 * `npm run typecheck`, not by an assertion on the wire.
 */
export type ProfileMe = Pick<
  components['schemas']['users'],
  | 'id'
  | 'username'
  | 'email'
  | 'created_at'
  | 'country_code'
  | 'region_code'
  | 'city'
  | 'geo_source'
  | 'geo_accuracy_km'
  | 'geo_updated_at'
  | 'first_name'
  | 'last_name'
>;