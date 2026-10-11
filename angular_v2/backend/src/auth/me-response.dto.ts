import { ApiProperty } from '@nestjs/swagger';

export class MeResponseDto {
  @ApiProperty()
  sub: string;

  @ApiProperty()
  role: string;

  /** Seconds until the presented access token expires. */
  @ApiProperty()
  expiresIn: number;
}
