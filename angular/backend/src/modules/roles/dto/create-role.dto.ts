import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ description: 'The name of the role' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the role' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether this is a system role',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isSystemRole?: boolean;

  @ApiPropertyOptional({
    description: 'Whether this is a default role',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Parent role ID' })
  @IsNumber()
  @IsOptional()
  parentId?: number;

  @ApiPropertyOptional({
    description: 'Array of permission IDs to assign to the role',
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  permissionIds?: number[];
}
