import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateResourceDto {
  @ApiProperty({ description: 'Resource name', example: 'users' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Resource description',
    required: false,
    example: 'User management resource',
  })
  @IsString()
  @IsOptional()
  description?: string;
}
