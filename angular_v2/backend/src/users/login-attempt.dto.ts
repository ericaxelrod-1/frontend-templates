import { ApiProperty } from '@nestjs/swagger';

/**
 * One row of `GET /api/users/me/login-attempts`.
 *
 * ## SIX FIELDS, AND `username` IS NOT ONE OF THEM
 *
 * The response is the six the contract names, in that order:
 * `id, ip, status, attempt_kind, created_at, ip_subnet`. The table has more — `username`
 * and `ip_normalized` — and both are deliberately withheld:
 *
 *   * `username` would be the caller's own username repeated on every row, saying
 *     nothing they do not already know, and it is the column the endpoint filters on.
 *   * `ip_normalized` is the canonical host the reputation counters key on, and
 *     `ip_subnet` is the aggregated form of it. Sending the raw canonical address as
 *     well would hand back the pre-aggregation value for a field the response already
 *     carries in its aggregated shape.
 *
 * The frontend's `features/profile/login-attempt.ts` is a `Pick` of exactly these six
 * out of `components['schemas']['login_attempts']`, so a seventh field here would be a
 * type the generated schema does not describe.
 *
 * ## `ip` AND `ip_subnet` ARE BOTH SENT, ON PURPOSE
 *
 * The frontend renders them together (`login-history.ts`) so a reader can tell a
 * single host from a crowd behind one address. Dropping `ip` would make every row look
 * like a crowd; dropping `ip_subnet` would make a subnet look like a single attacker.
 *
 * ## `status` IS A CREDENTIAL VOCABULARY AND SAYS NOTHING ELSE
 *
 * `CHECK (status IN ('failed', 'succeeded'))` (`0002:97`). A `token_request` row carries
 * `'failed'` because neither value is literally true of it — `0019_login_attempt_kind.sql`
 * argues that at length, and the short form is that the counter has to count attempts or
 * the limit is never reached. So `'failed'` on this page does not always mean a wrong
 * password, and the page must not claim otherwise.
 */
export class LoginAttemptDto {
  @ApiProperty({ format: 'uuid', description: 'The attempt row id.' })
  id: string;

  @ApiProperty({ nullable: true, description: 'Source address as the transport reported it, or NULL.' })
  ip: string | null;

  @ApiProperty({ description: "`failed` or `succeeded`; see the class comment for why a link request also reads `failed`." })
  status: string;

  @ApiProperty({ description: "`login` or `token_request` — which route produced the row." })
  attempt_kind: string;

  @ApiProperty({ description: 'When the attempt was recorded.' })
  created_at: string;

  @ApiProperty({ nullable: true, description: 'The aggregated key the reputation counters group by, or NULL when untracked.' })
  ip_subnet: string | null;
}
