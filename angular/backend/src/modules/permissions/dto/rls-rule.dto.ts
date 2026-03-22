import { IsString, IsOptional, IsBoolean, IsInt, IsArray, MaxLength, MinLength, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateRlsRuleDto {
  @IsInt()
  groupId: number;

  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  targetTable: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  sql: string;

  @IsOptional()
  parameters?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  skipValidation?: boolean;
}

export class UpdateRlsRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  sql?: string;

  @IsOptional()
  parameters?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  skipValidation?: boolean;

  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class ValidateRlsRuleDto {
  @IsInt()
  groupId: number;

  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  targetTable: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  sql: string;
}

export class InvalidateCacheDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tableName?: string;
}
