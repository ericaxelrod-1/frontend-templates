import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { CaptchaService } from './captcha.service';
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
  generateCaptcha(@Query('debug') debug?: string): CaptchaResult {
    const includeTextInResponse =
      debug === 'true' && process.env.NODE_ENV !== 'production';
    return this.captchaService.generateCaptcha(includeTextInResponse);
  }

  /**
   * Verify a CAPTCHA response
   */
  @Post('verify')
  verifyCaptcha(@Body() body: CaptchaVerifyRequest): CaptchaVerifyResponse {
    const { captchaId, userInput } = body;

    if (!captchaId || !userInput) {
      throw new BadRequestException('captchaId and userInput are required');
    }

    const isValid = this.captchaService.verifyCaptcha(captchaId, userInput);

    return {
      success: isValid,
      message: isValid
        ? 'CAPTCHA verification successful'
        : 'CAPTCHA verification failed',
    };
  }
}
