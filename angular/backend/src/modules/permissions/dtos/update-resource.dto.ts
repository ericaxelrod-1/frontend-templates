import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateResourceDto {
  @ApiProperty({ example: 'users', description: 'The resource name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 'User management',
    description: 'Description of the resource',
  })
  @IsString()
  @IsOptional()
  description?: string;
}
