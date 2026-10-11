import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LogoutRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  refreshToken: string;
}
