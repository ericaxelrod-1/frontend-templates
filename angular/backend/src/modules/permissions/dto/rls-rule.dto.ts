import { IsString, IsOptional, IsBoolean, IsInt, IsArray, MaxLength, ValidateNested, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ScopeConditionDto {
  @IsString()
  @MaxLength(255)
  column: string;

  @IsString()
  @MaxLength(20)
  operator: string;

  @IsOptional()
  @IsString()
  value?: string;
}

export class ScopeGroupDto {
  @IsIn(['AND', 'OR'])
  logicalOperator: 'AND' | 'OR';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScopeConditionDto, {
    discriminator: {
      property: 'logicalOperator',
      subTypes: [
        { value: ScopeGroupDto, name: 'AND' },
        { value: ScopeGroupDto, name: 'OR' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  conditions: (ScopeConditionDto | ScopeGroupDto)[];
}

export type ScopeGroupItemDto = ScopeConditionDto | ScopeGroupDto;

export class CreateRlsRuleDto {
  @IsInt()
  groupId: number;

  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => value?.toLowerCase().trim())
  targetTable: string;

  @ValidateNested()
  @Type(() => ScopeGroupDto)
  scope: ScopeGroupDto;

  @IsOptional()
  @IsBoolean()
  skipValidation?: boolean;
}

export class UpdateRlsRuleDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ScopeGroupDto)
  scope?: ScopeGroupDto;

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

  @ValidateNested()
  @Type(() => ScopeGroupDto)
  scope: ScopeGroupDto;
}

export class InvalidateCacheDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tableName?: string;
}
