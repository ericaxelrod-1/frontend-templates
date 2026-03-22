import { IsString, IsOptional, IsBoolean, IsInt, IsArray, ValidateNested, MaxLength, IsNotEmpty } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateJoinConditionDto {
  @IsString()
  @MaxLength(255)
  @IsNotEmpty()
  fromTable: string;

  @IsString()
  @MaxLength(255)
  @IsNotEmpty()
  fromColumn: string;

  @IsString()
  @MaxLength(255)
  @IsNotEmpty()
  toTable: string;

  @IsString()
  @MaxLength(255)
  @IsNotEmpty()
  toColumn: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  operator?: string;
}

export class CreateRlsJoinPathDto {
  @IsString()
  @MaxLength(255)
  @IsNotEmpty()
  name: string;

  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  targetTable: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  chain: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJoinConditionDto)
  conditions?: CreateJoinConditionDto[];
}

export class UpdateRlsJoinPathDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  targetTable?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chain?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJoinConditionDto)
  conditions?: CreateJoinConditionDto[];
}
