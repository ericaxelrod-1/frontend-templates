import { IsString, IsOptional, IsInt, IsArray, MaxLength, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateRlsScopeTemplateDto {
  @IsString()
  @MaxLength(255)
  @IsNotEmpty()
  name: string;

  @IsInt()
  joinPathId: number;

  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  targetTable: string;

  @IsArray()
  @IsString({ each: true })
  availableColumns: string[];
}

export class UpdateRlsScopeTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  joinPathId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  targetTable?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableColumns?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  scopeSql?: string;

  @IsOptional()
  parameters?: Record<string, any>;
}
