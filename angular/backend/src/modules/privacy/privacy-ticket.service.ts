import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

export interface PrivacyTicket {
  id: number;
  userId: number;
  requestType:
    | 'access'
    | 'deletion'
    | 'correction'
    | 'restriction'
    | 'objection'
    | 'portability'
    | 'other';
  status: 'pending' | 'in_review' | 'completed' | 'rejected';
  description: string;
  additionalData?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  resolution?: string;
}

export interface CreateTicketDto {
  requestType: PrivacyTicket['requestType'];
  description: string;
  additionalData?: Record<string, any>;
}

@Injectable()
export class PrivacyTicketService {
  private tickets: Map<number, PrivacyTicket[]> = new Map();

  constructor() {}

  async createTicket(
    userId: number,
    dto: CreateTicketDto,
  ): Promise<PrivacyTicket> {
    const ticket: PrivacyTicket = {
      id: Date.now(),
      userId,
      requestType: dto.requestType,
      status: 'pending',
      description: dto.description,
      additionalData: dto.additionalData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const userTickets = this.tickets.get(userId) || [];
    userTickets.push(ticket);
    this.tickets.set(userId, userTickets);

    return ticket;
  }

  async getUserTickets(userId: number): Promise<PrivacyTicket[]> {
    return this.tickets.get(userId) || [];
  }

  async getTicket(
    userId: number,
    ticketId: number,
  ): Promise<PrivacyTicket | null> {
    const userTickets = this.tickets.get(userId) || [];
    return userTickets.find((t) => t.id === ticketId) || null;
  }

  async updateTicketStatus(
    userId: number,
    ticketId: number,
    status: PrivacyTicket['status'],
    resolution?: string,
  ): Promise<PrivacyTicket | null> {
    const userTickets = this.tickets.get(userId) || [];
    const ticketIndex = userTickets.findIndex((t) => t.id === ticketId);

    if (ticketIndex === -1) {
      return null;
    }

    const ticket = userTickets[ticketIndex];
    ticket.status = status;
    ticket.updatedAt = new Date();

    if (status === 'completed' || status === 'rejected') {
      ticket.completedAt = new Date();
      ticket.resolution = resolution;
    }

    userTickets[ticketIndex] = ticket;
    this.tickets.set(userId, userTickets);

    return ticket;
  }
}
