import {
  IsString,
  IsEmail,
  MinLength,
  IsOptional,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../entities/role.entity';

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
    description: 'User role',
  })
  @IsOptional()
  @IsObject()
  role?: Role;

  @ApiPropertyOptional({
    example: { theme: 'dark', language: 'en' },
    description: 'User preferences',
  })
  @IsOptional()
  @IsObject()
  preferences?: {
    theme?: string;
    language?: string;
    notifications?: {
      email?: boolean;
      push?: boolean;
    };
  };
}
