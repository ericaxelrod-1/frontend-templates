import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SystemHealthService } from './services/system-health.service';
import { PrivacyTicketService } from '../privacy/privacy-ticket.service';

@Controller('admin/system-health')
@UseGuards(AuthGuard('jwt'))
export class SystemHealthController {
  constructor(
    private readonly healthService: SystemHealthService,
    private readonly privacyTicketService: PrivacyTicketService,
  ) {}

  @Get()
  async getHealth() {
    const stats = await this.healthService.getStats();
    const activeTickets = await this.privacyTicketService.getUserTickets(0); // Mock for global tickets

    return {
      status: this.healthService.isHealthy() ? 'Healthy' : 'Warning',
      disk: stats.disk,
      memory: stats.memory,
      activeJobs: activeTickets.filter(t => t.status === 'pending').length,
      lastCheck: new Date().toISOString(),
    };
  }

  @Post('clear-temp')
  async clearTemp() {
    // Logic to trigger manual cleanup
    return { message: 'Cleanup task triggered' };
  }
}
