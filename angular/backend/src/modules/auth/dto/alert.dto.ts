import {
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcknowledgeAlertDto {
  @ApiProperty({ description: 'Optional notes for acknowledging the alert' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ResolveAlertDto {
  @ApiProperty({ description: 'Resolution notes for the alert' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateAlertDto {
  @ApiProperty({ description: 'Type of alert' })
  @IsString()
  alertType: string;

  @ApiProperty({
    description: 'Alert severity',
    enum: ['low', 'medium', 'high', 'critical'],
  })
  @IsEnum(['low', 'medium', 'high', 'critical'])
  severity: string;

  @ApiProperty({ description: 'Alert title' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Alert message' })
  @IsString()
  message: string;

  @ApiProperty({ description: 'Alert source', required: false })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({
    description: 'IP address associated with alert',
    required: false,
  })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiProperty({
    description: 'User ID associated with alert',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  userId?: number;

  @ApiProperty({
    description: 'Pattern ID associated with alert',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  patternId?: number;

  @ApiProperty({
    description: 'Additional alert data as JSON string',
    required: false,
  })
  @IsOptional()
  @IsString()
  alertData?: string;

  @ApiProperty({ description: 'Alert expiration date', required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class AlertFiltersDto {
  @ApiProperty({ description: 'Filter by alert status', required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: 'Filter by alert severity', required: false })
  @IsOptional()
  @IsString()
  severity?: string;

  @ApiProperty({ description: 'Filter by alert type', required: false })
  @IsOptional()
  @IsString()
  alertType?: string;

  @ApiProperty({ description: 'Filter from date', required: false })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({ description: 'Filter to date', required: false })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({ description: 'Sort field', required: false })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiProperty({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @ApiProperty({ description: 'Number of results per page', required: false })
  @IsOptional()
  @IsNumber()
  limit?: number;

  @ApiProperty({ description: 'Page offset', required: false })
  @IsOptional()
  @IsNumber()
  offset?: number;
}

export class BlockUserDto {
  @ApiProperty({ description: 'Reason for blocking the user' })
  @IsString()
  reason: string;

  @ApiProperty({
    description: 'Block duration in hours (optional, 0 = permanent)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  durationHours?: number;
}
