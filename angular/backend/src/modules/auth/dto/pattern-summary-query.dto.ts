import { IsOptional, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PatternSummaryQueryDto {
  @ApiProperty({
    description: 'Start date for time filter (ISO 8601 format)',
    required: false,
    example: '2025-07-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({
    description: 'End date for time filter (ISO 8601 format)',
    required: false,
    example: '2025-07-03T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({
    description: 'Predefined time range filter',
    enum: ['24h', '7d', '30d', '90d', 'all'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['24h', '7d', '30d', '90d', 'all'])
  timeRange?: '24h' | '7d' | '30d' | '90d' | 'all';
}
