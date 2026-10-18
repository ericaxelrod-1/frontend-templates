/**
 * The body of the `202` from `POST /api/users/me/email`.
 *
 * ## Hand-written, and that is structural rather than a shortcut
 *
 * `src/app/api/schema.ts` is produced by `openapi-typescript` from
 * `angular_v2/openapi.json`, and that document is emitted by **PostgREST** from the
 * live schema — it describes the CRUD layer only. The thin Nest app's own routes
 * have no generated contract (AGENTS.md §B3: `@ApiProperty()` applies to its own
 * routes and PostgREST is not involved), so `auth.types.ts` is a hand-written
 * mirror of the `auth` routes and this is the same case for the `users/me` routes.
 * The authority for the shape is the route's declared response; if a field is added
 * to it, this file is where it has to be added too, because there is nothing to
 * regenerate. See `password-change-request.ts` for the other one.
 *
 * ## What `accepted: true` does and does not mean
 *
 * It means the request was taken and a verification link is on its way to the new
 * address. It does NOT mean the account's address has changed, and it does not mean
 * it will: the address changes only when the member opens the link, and until then
 * the old address remains the one on file. `accepted` is deliberately the whole
 * body — a response that echoed the pending address would invite a client to render
 * it as the account's own, which is precisely the mistake the two-phase flow
 * exists to prevent.
 */
export interface EmailChangeAccepted {
  readonly accepted: true;
}