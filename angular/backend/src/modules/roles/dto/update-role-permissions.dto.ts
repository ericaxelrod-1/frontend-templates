import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRolePermissionsDto {
  @ApiProperty({
    description: 'Array of permission names to assign to the role',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}
