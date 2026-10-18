import type { ProfileMe } from './profile-me';

/**
 * The body of `POST /api/users/me/email`.
 *
 * The field is `email` and the value is the address the member wants NEXT, not the
 * one on file. Nothing about the current address is accepted on this route,
 * because nothing about it changes until the new one is confirmed.
 */
export type EmailChangeRequest = Pick<ProfileMe, 'email'>;