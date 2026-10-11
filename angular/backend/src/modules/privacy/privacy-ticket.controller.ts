import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  PrivacyTicketService,
  CreateTicketDto,
} from './privacy-ticket.service';
import { Request } from 'express';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

interface AuthenticatedRequest extends Request {
  user: { id: number; email: string };
}

@Controller('privacy/tickets')
@UseGuards(AuthGuard('jwt'))
export class PrivacyTicketController {
  constructor(private readonly privacyTicketService: PrivacyTicketService) {}

  @Post()
  async createTicket(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateTicketDto,
  ) {
    return this.privacyTicketService.createTicket(req.user.id, dto);
  }

  @Get()
  async getTickets(@Req() req: AuthenticatedRequest) {
    return this.privacyTicketService.getUserTickets(req.user.id);
  }

  @Get('all')
  @UseGuards(PermissionGuard)
  @RequirePermission('privacy:read')
  async getAllTickets() {
    return this.privacyTicketService.getAllTickets();
  }

  @Get(':id')
  async getTicket(
    @Req() req: AuthenticatedRequest,
    @Param('id') ticketId: string,
  ) {
    const ticket = await this.privacyTicketService.getTicket(
      req.user.id,
      parseInt(ticketId, 10),
    );

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }
}
