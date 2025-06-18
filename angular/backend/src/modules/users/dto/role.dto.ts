import { IsArray, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SystemRoles } from '../entities/role.entity';

export class UpdateRolePermissionsDto {
  @ApiProperty({
    description: 'List of permission strings',
    example: [
      'users:create',
      'users:delete',
      'users:edit',
      'users:view',
      'groups:manage',
      'roles:manage',
    ],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @ApiProperty({
    description: 'Name of the role',
    example: 'Content Manager',
    required: false,
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Description of the role',
    example: 'User who can manage content but not users or system settings',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'List of permission strings to replace current permissions',
    example: [
      'content:create',
      'content:edit',
      'content:delete',
      'content:view',
      'users:view',
    ],
    type: [String],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}

export class AssignRoleDto {
  @ApiProperty({
    description: 'Role ID to assign to the user',
    example: 1,
  })
  roleId: number;
}

export class CreateRoleDto {
  @ApiProperty({
    description: 'Name of the role',
    example: 'Content Manager',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Description of the role',
    example: 'User who can manage content but not users or system settings',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'List of permission strings',
    example: [
      'content:create',
      'content:edit',
      'content:delete',
      'content:view',
      'users:view',
    ],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}
