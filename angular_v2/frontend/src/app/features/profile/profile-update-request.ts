import type { ProfileMe } from './profile-me';

/**
 * The body of `PATCH /api/users/me`.
 *
 * Two columns, because two are editable and the rest are not. `username` is not
 * here because it is immutable (`0008_user_identity.sql`); `email` is not here
 * because it has its own two-phase route that verifies a new address before
 * applying it; `id` is not here because a caller does not name its own key; and
 * `created_at` is not here because it is not the member's to set.
 *
 * Both fields are optional so an empty string is a meaningful body — clearing a name
 * is `""` being rejected by `users_first_name_not_blank`, not the column being
 * absent. That distinction is the server's to draw (`ValidationPipe` with
 * `forbidNonWhitelisted`), so this type does not pretend to resolve it.
 */
export type ProfileUpdateRequest = Pick<ProfileMe, 'first_name' | 'last_name'>;