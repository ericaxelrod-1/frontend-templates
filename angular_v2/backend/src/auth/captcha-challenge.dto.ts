import { ApiProperty } from '@nestjs/swagger';

/**
 * The challenge, as the issuer hands it over.
 *
 * **There is no answer field, and that is the shape rather than an omission.**
 * `0022_security_telemetry.sql` stores the answer as a salted digest precisely
 * so the row is not an oracle for whoever can read the table, and this payload
 * is the same idea on the wire: the question travels, the answer does not.
 *
 * `type` is `'text' | 'image'` in the table's CHECK; this build issues `'text'`,
 * because §B6 requires an accessible non-visual alternative and the text
 * challenge is it.
 */
export class CaptchaChallengeDto {
  @ApiProperty({ description: 'The token the answer is presented with. Only its digest is stored.' })
  token: string;

  @ApiProperty({ description: 'The question, as text.' })
  challenge: string;

  @ApiProperty({ enum: ['text'], description: 'The challenge type. This build issues `text`.' })
  type: 'text';

  @ApiProperty({ description: 'ISO-8601 expiry of the challenge.' })
  expiresAt: string;
}
