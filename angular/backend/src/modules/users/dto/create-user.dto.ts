import {
  IsString,
  IsEmail,
  MinLength,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    example: 'john.doe',
    description: 'Username (unique identifier)',
  })
  @IsString()
  username: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Password123!',
    description: 'User password',
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    example: 'John',
    description: 'User first name',
  })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Doe',
    description: 'User last name',
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({
    example: [1, 2],
    description: 'Array of role IDs to assign to the user',
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  roleIds?: number[];

  @ApiPropertyOptional({
    example: [1, 3, 5],
    description: 'Array of group IDs to assign the user to',
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  groupIds?: number[];

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the user should be required to change password on first login',
  })
  @IsBoolean()
  @IsOptional()
  requiresPasswordChange?: boolean;

  @ApiPropertyOptional({
    example: { theme: 'dark', language: 'en' },
    description: 'User preferences',
  })
  @IsOptional()
  preferences?: {
    theme?: string;
    language?: string;
    notifications?: {
      email?: boolean;
      push?: boolean;
    };
  };
}
