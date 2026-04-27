import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrivacyTicket, PrivacyRequestType, PrivacyRegulation, PrivacyTicketStatus } from './entities/privacy-ticket.entity';
import { PrivacyJob, PrivacyJobStatus } from './entities/privacy-job.entity';
import { User } from '../users/entities/user.entity';

export interface CreateTicketDto {
  requestType: PrivacyRequestType;
  regulation: PrivacyRegulation;
  email?: string;
}

@Injectable()
export class PrivacyTicketService {
  constructor(
    @InjectRepository(PrivacyTicket)
    private readonly ticketRepository: Repository<PrivacyTicket>,
    @InjectRepository(PrivacyJob)
    private readonly jobRepository: Repository<PrivacyJob>,
  ) {}

  async createTicket(
    userId: number,
    dto: CreateTicketDto,
  ): Promise<PrivacyTicket> {
    const slaDeadline = new Date();
    slaDeadline.setDate(slaDeadline.getDate() + 30); // 30 days SLA

    const ticket = this.ticketRepository.create({
      userId,
      requestType: dto.requestType,
      regulation: dto.regulation,
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
