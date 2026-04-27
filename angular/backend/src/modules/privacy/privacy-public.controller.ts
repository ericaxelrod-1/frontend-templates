import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
} from '@nestjs/common';
import {
  PrivacyTicketService,
  CreateTicketDto,
} from './privacy-ticket.service';
import { Request } from 'express';

@Controller('privacy/tickets/public')
export class PrivacyPublicController {
  constructor(private readonly privacyTicketService: PrivacyTicketService) {}

  @Post()
  async createPublicTicket(
    @Req() req: Request,
    @Body() dto: CreateTicketDto,
  ) {
    // Inject IP address for jurisdictional resolution
    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;
    return this.privacyTicketService.createPublicTicket({
      ...dto,
      ipAddress,
    });
  }

  @Get('status')
  async getTicketStatus(@Query('token') token: string) {
    return this.privacyTicketService.getTicketByToken(token);
  }
}
