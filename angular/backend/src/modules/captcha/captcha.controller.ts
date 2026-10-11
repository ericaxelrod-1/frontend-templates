import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { CaptchaService } from '../auth/services/captcha.service';
import { Request } from 'express';
import {
  CaptchaResult,
  CaptchaVerifyRequest,
  CaptchaVerifyResponse,
} from './captcha.models';

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  /**
   * Generate a new CAPTCHA
   */
  @Get('generate')
  async generateCaptcha(
    @Req() req: Request,
    @Query('type') type: any = 'image',
    @Query('debug') debug?: string,
  ): Promise<CaptchaResult> {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const captcha = await this.captchaService.create(type, ipAddress);

    const includeTextInResponse =
      debug === 'true' && process.env.NODE_ENV !== 'production';

    return {
      token: captcha.token,
      challenge: captcha.challenge,
      type: captcha.type,
      ...(includeTextInResponse && { text: captcha.solution }),
    };
  }

  /**
   * Verify a CAPTCHA response
   */
  @Post('verify')
  async verifyCaptcha(
    @Body() body: CaptchaVerifyRequest,
  ): Promise<CaptchaVerifyResponse> {
    const { captchaToken, captchaSolution } = body;

    if (!captchaToken || !captchaSolution) {
      throw new BadRequestException('captchaToken and captchaSolution are required');
    }

    const isValid = await this.captchaService.validate(captchaToken, captchaSolution);

    return {
      success: isValid,
      message: isValid
        ? 'CAPTCHA verification successful'
        : 'CAPTCHA verification failed',
    };
  }
}
