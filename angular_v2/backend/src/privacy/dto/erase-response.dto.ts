import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of an erasure operation.
 *
 * Matches `ErasureOutcome` produced by `ErasureService`.
 */
export class EraseResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Subject ID that was erased' })
  userId: string;

  @ApiProperty({ description: 'True when the account was already anonymised' })
  alreadyErased: boolean;

  @ApiProperty({ description: 'The neutral tombstone email address assigned' })
  tombstoneAddress: string;

  @ApiProperty({
    nullable: true,
    description: 'Timestamp when erasure was applied (or previously applied)',
  })
  anonymizedAt: string | Date | null;

  @ApiProperty({ description: 'Key identifier of the HMAC pepper used' })
  pepperKid: string;
}
