import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsObject,
  Min,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({
    description: 'Name of the group',
    example: 'Development Team',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Description of the group',
    example: 'Team responsible for application development',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateGroupSettingsDto {
  @ApiProperty({
    description: 'Group settings configuration',
    example: {
      canShareData: true,
      canShareAssets: true,
      maxMembers: 50,
    },
  })
  @IsObject()
  settings: {
    canShareData?: boolean;
    canShareAssets?: boolean;
    maxMembers?: number;
  };
}

export class UpdateMemberPermissionsDto {
  @ApiProperty({
    description: 'List of permission strings for the member in the group',
    example: ['group:invite', 'group:remove', 'group:settings'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @ApiProperty({
    description: 'Whether the user is a group admin',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  isAdmin?: boolean;
}
