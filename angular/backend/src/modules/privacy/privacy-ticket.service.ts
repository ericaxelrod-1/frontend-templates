import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PrivacyTicket, PrivacyRequestType, PrivacyRegulation, PrivacyTicketStatus } from './entities/privacy-ticket.entity';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { User } from '../users/entities/user.entity';
import { PrivacyJurisdictionService } from './privacy-jurisdiction.service';
import { PrivacyMagicLinkService } from './privacy-magic-link.service';
import { UsersService } from '../users/users.service';

export interface CreateTicketDto {
  requestType: PrivacyRequestType;
  regulation?: PrivacyRegulation;
  email?: string;
  ipAddress?: string;
  declaredRegion?: string;
  description?: string;
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
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async createTicket(
    userId: number | null,
    dto: CreateTicketDto,
    isPublic: boolean = false,
  ): Promise<PrivacyTicket> {
    let profileRegion: string | undefined;

    if (userId) {
      const user = await this.usersService.findOne(userId);
      if (user && user.preferences && user.preferences.region) {
        profileRegion = user.preferences.region;
      }
    }

    const regulation = this.jurisdictionService.resolveRegulation(
      dto.ipAddress,
      dto.declaredRegion,
      profileRegion,
    );

    const windowHours = this.configService.get<number>('privacy.verificationWindowHours') || 24;

    // Public requests start in UNVERIFIED state - SLA clock doesn't start until email is confirmed
    // Authenticated requests go directly to PENDING with SLA deadline
    const status = isPublic ? PrivacyTicketStatus.UNVERIFIED : PrivacyTicketStatus.PENDING;
    const slaDeadline = isPublic ? null : this.jurisdictionService.getSlaDeadline(regulation);

    const ticket = this.ticketRepository.create({
      userId,
      requestType: dto.requestType,
      regulation,
      email: dto.email,
      slaDeadline,
      status,
      description: dto.description,
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
    const ticket = await this.createTicket(null, dto, true);

    const windowHours = this.configService.get<number>('privacy.verificationWindowHours') || 24;
    const token = this.magicLinkService.generateToken(ticket.id, dto.email, `${windowHours}h`);
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

  async verifyTicket(ticketId: number): Promise<PrivacyTicket> {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.status !== PrivacyTicketStatus.UNVERIFIED) {
      return ticket;
    }

    // SLA clock starts only after verification
    ticket.slaDeadline = this.jurisdictionService.getSlaDeadline(ticket.regulation);
    ticket.status = PrivacyTicketStatus.PENDING;
    
    await this.ticketRepository.save(ticket);

    // Release to the background worker queue
    const job = this.jobRepository.create({
      ticketId: ticket.id,
      status: PrivacyJobStatus.PENDING,
    });
    await this.jobRepository.save(job);

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
