import { ApiProperty } from '@nestjs/swagger';

export class PatternSummaryDto {
  @ApiProperty({ description: 'Pattern type identifier' })
  patternType: string;

  @ApiProperty({ description: 'Human-readable pattern name' })
  displayName: string;

  @ApiProperty({ description: 'Total count of patterns of this type' })
  count: number;

  @ApiProperty({ 
    description: 'Predominant severity level',
    enum: ['low', 'medium', 'high', 'critical']
  })
  severity: 'low' | 'medium' | 'high' | 'critical';

  @ApiProperty({ description: 'Most recent detection timestamp' })
  lastDetected: Date;

  @ApiProperty({ description: 'Percentage of total patterns', required: false })
  percentage?: number;
} 