import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  username: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password: string;

  /**
   * The challenge token, when the gate demanded one.
   *
   * **Both fields are optional because the challenge is RISK-SCOPED.** A login
   * below the threshold carries neither, and the global `ValidationPipe` runs
   * with `forbidNonWhitelisted`, so the properties have to be declared here for
   * the body to be accepted at all.
   *
   * The token is bounded at 512 characters because it is a 256-bit random value
   * in base64url — 43 characters — and a body carrying a kilobyte of "token" is
   * not a client.
   */
  @ApiProperty({ required: false, description: 'The challenge token, when the gate demanded a challenge.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  captchaToken?: string;

  /**
   * The answer to the challenge.
   *
   * Bounded at 64 characters: the answer this build issues is a number of at
   * most two digits, and a longer one is not a person typing an answer.
   */
  @ApiProperty({ required: false, description: 'The answer to the challenge.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  captchaAnswer?: string;
}
