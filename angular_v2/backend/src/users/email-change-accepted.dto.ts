import { ApiProperty } from '@nestjs/swagger';

/**
 * The `202` from `POST /api/users/me/email`.
 *
 * ## `accepted` IS THE ONLY FIELD, AND THAT IS THE POINT
 *
 * **It does not mean the address changed.** It means a request was taken and a
 * confirmation link is on its way to the NEW address. The address changes only when
 * the member opens that link, and at the moment this body is returned it has not.
 *
 * The body deliberately carries no pending address, no expiry and no token id:
 *
 *  * **No pending address.** A response that echoed it would invite a client to render
 *    it as the account's own — which is precisely the mistake the two-phase flow
 *    exists to prevent, and the frontend's `email-change-accepted.ts` says the same
 *    thing from the other side of the wire.
 *  * **No expiry or token id.** Each of those is a receipt, and a receipt is a
 *    function of whether the account exists. This route has no enumeration defence to
 *    protect (the caller is authenticated and knows their own account), so it does not
 *    need to imitate `TokenRequestAcceptedDto`'s uniformity — but it also gains
 *    nothing by handing out a second copy of a fact the mail already states.
 *
 * ## WHY `202` AND NOT `200`
 *
 * `200 OK` says *this happened*. `202 Accepted` says *this was received*, and what this
 * route has actually done is received a request: the mail is in flight and the address
 * is untouched. Changing either half changes what the response asserts.
 *
 * ## THE CONSEQUENCE, STATED RATHER THAN DISCOVERED
 *
 * Because the pending address lives in the token and not on the row, **a page reload
 * loses the "pending" indication** — there is nothing to read it back from, and
 * `GET /users/me` will keep returning the old address until the link is redeemed. That
 * is correct rather than broken: the old address is the one actually in force, so it is
 * the one the profile page should show. It is also why the frontend keeps the pending
 * address in the form that made the request rather than re-reading it
 * (`email-change-form.ts`).
 */
export class EmailChangeAcceptedDto {
  @ApiProperty({
    description:
      'Always `true`. The request was received and a confirmation link is on its way — the address on file is UNCHANGED.',
  })
  accepted: true;
}
