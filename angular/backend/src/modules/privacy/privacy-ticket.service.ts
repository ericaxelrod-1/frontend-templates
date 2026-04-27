import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrivacyTicket, PrivacyRequestType, PrivacyRegulation, PrivacyTicketStatus } from './entities/privacy-ticket.entity';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { User } from '../users/entities/user.entity';
import { PrivacyJurisdictionService } from './privacy-jurisdiction.service';
import { PrivacyMagicLinkService } from './privacy-magic-link.service';

export interface CreateTicketDto {
  requestType: PrivacyRequestType;
  regulation?: PrivacyRegulation;
  email?: string;
  ipAddress?: string;
  declaredRegion?: string;
}

@Injectable()
export class PrivacyTicketService {
  constructor(
    @InjectRepository(PrivacyTicket)
    private readonly ticketRepository: Repository<PrivacyTicket>,
    @InjectRepository(PrivacyJob)
    private readonly jobRepository: Repository<PrivacyJob>,
    private readonly jurisdictionService: PrivacyJurisdictionService,
    private readonly magicLinkService: PrivacyMagicLinkService,
  ) {}

  async createTicket(
    userId: number | null,
    dto: CreateTicketDto,
  ): Promise<PrivacyTicket> {
    const regulation = dto.regulation || 
      this.jurisdictionService.resolveRegulation(dto.ipAddress, dto.declaredRegion);
    
    const slaDeadline = this.jurisdictionService.getSlaDeadline(regulation);

    const ticket = this.ticketRepository.create({
      userId,
      requestType: dto.requestType,
      regulation,
      email: dto.email,
      slaDeadline,
      status: PrivacyTicketStatus.PENDING,
    });

    const savedTicket = await this.ticketRepository.save(ticket);

    // Automatically create a job for this ticket
    const job = this.jobRepository.create({
      ticketId: savedTicket.id,
      status: PrivacyJobStatus.PENDING,
    });
    await this.jobRepository.save(job);

    return savedTicket;
  }

  async createPublicTicket(dto: CreateTicketDto): Promise<{ ticket: PrivacyTicket; magicLink: string }> {
    const ticket = await this.createTicket(null, dto);
    const token = this.magicLinkService.generateToken(ticket.id, dto.email);
    const magicLink = this.magicLinkService.generateUrl(token);
    
    // In a real app, you'd send an email here.
    console.log(`[Privacy] Magic link for ${dto.email}: ${magicLink}`);
    
    return { ticket, magicLink };
  }

  async getTicketByToken(token: string): Promise<PrivacyTicket> {
    const payload = this.magicLinkService.verifyToken(token);
    const ticket = await this.ticketRepository.findOne({
      where: { id: payload.ticketId, email: payload.email },
      relations: ['jobs'],
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  async getUserTickets(userId: number): Promise<PrivacyTicket[]> {
    return this.ticketRepository.find({
      where: { userId },
      relations: ['jobs'],
      order: { createdAt: 'DESC' },
    });
  }

  async getTicket(
    userId: number,
    ticketId: number,
  ): Promise<PrivacyTicket> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId, userId },
      relations: ['jobs'],
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  async updateTicketStatus(
    ticketId: number,
    status: PrivacyTicketStatus,
  ): Promise<PrivacyTicket> {
    await this.ticketRepository.update(ticketId, { status });
    return this.ticketRepository.findOne({ where: { id: ticketId } });
  }
}
