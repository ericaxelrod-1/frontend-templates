import { IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRoleDto {
  @ApiProperty({ description: 'The ID of the role to assign' })
  @IsNumber()
  roleId: number;
}
