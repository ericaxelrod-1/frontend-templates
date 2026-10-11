import { ApiProperty } from '@nestjs/swagger';

export class RefreshResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty()
  tokenType: 'Bearer';

  /** Access-token lifetime in seconds, echoed from the same config the signer used. */
  @ApiProperty()
  expiresIn: number;
}
