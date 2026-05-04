import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  PrivacyTicketService,
  CreateTicketDto,
} from './privacy-ticket.service';
import { CaptchaService } from '../auth/services/captcha.service';
import { Request } from 'express';

@Controller('privacy/tickets/public')
export class PrivacyPublicController {
  private readonly logger = new Logger(PrivacyPublicController.name);

  constructor(
    private readonly privacyTicketService: PrivacyTicketService,
    private readonly captchaService: CaptchaService, // ID 3: CAPTCHA
  ) {}

  @Post()
  async createPublicTicket(
    @Req() req: Request,
    @Body() body: any, // Use 'any' temporarily to debug the payload structure
  ) {
    if (!body) {
      throw new BadRequestException('Empty body');
    }

    this.logger.debug('Received privacy request payload:', body);

    // Explicitly destructure
    const { email, requestType, description, captchaToken, captchaSolution } = body;

    // ID 3: CAPTCHA validation
    if (!captchaToken || !captchaSolution) {
      throw new BadRequestException('CAPTCHA token and solution are required');
    }

    const isCaptchaValid = await this.captchaService.validate(captchaToken, captchaSolution);
    if (!isCaptchaValid) {
      throw new BadRequestException('Invalid CAPTCHA solution');
    }

    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    return this.privacyTicketService.createPublicTicket({
      email,
      requestType,
      description,
      ipAddress,
    });
  }

  @Get('status')
  async getTicketStatus(@Query('token') token: string) {
    return this.privacyTicketService.getTicketByToken(token);
  }
}
