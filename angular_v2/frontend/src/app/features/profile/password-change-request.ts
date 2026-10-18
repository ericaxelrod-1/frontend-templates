/**
 * The body of `POST /api/users/me/password`.
 *
 * ## Hand-written, for the same reason as `email-change-accepted.ts`
 *
 * The generated document describes PostgREST's CRUD surface, not the thin Nest
 * app's own routes, so there is nothing to generate this from. The snake_case keys
 * are the wire names (AGENTS.md §B1: one naming convention, end to end) and they
 * are the DTO's property names in `backend/src/users/`.
 *
 * `current_password` is required and is not optional because a password change that
 * did not prove the current one is a reset, and a reset belongs on a route that
 * sends a token to a channel the account holder controls. This route is reached
 * with a session, so the session plus the current password is the whole
 * authentication the change asks for.
 */
export interface PasswordChangeRequest {
  readonly current_password: string;
  readonly new_password: string;
}