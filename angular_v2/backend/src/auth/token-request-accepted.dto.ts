import { ApiProperty } from '@nestjs/swagger';

/**
 * The response to a request for a one-time-token link, for a registered address
 * and an unregistered one alike.
 *
 * ## This body is the enumeration defence, so it says nothing at all
 *
 * One field, one value, no identifier, no timestamp, no hint. It is deliberately
 * NOT a receipt: there is no token id, no expiry, no "we sent a message to…",
 * because every one of those is a function of whether the account exists. A body
 * that confirmed "an email is on its way" would be true for one caller and false
 * for the other, which is the oracle in a nicer font.
 *
 * ## And the status code is 202, for the same reason it is not 200
 *
 * `200 OK` says *this happened*. `202 Accepted` says *this was received* — and
 * receiving is exactly what the application can honestly claim about a request it
 * will answer identically either way. The route pairs this DTO with
 * `@HttpCode(202)`; changing either half changes what the response asserts.
 *
 * @see TokenRequestDto for why a 400 on a malformed address does not weaken this.
 */
export class TokenRequestAcceptedDto {
  @ApiProperty({ description: 'Always `accepted`, whether or not the address is registered.' })
  status: 'accepted';
}