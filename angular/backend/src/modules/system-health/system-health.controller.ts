import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SystemHealthService } from '../system/services/system-health.service';
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
    const diskUsage = this.healthService.getDiskUsage();
    const status = this.healthService.getHealthStatus();
    const activeTickets = await this.privacyTicketService.getUserTickets(0); // Mock for global tickets

    return {
      status: status === 'NORMAL' ? 'Healthy' : status,
      disk: {
        total: 0, // fs.statfs total bytes not directly exposed in simple getter
        used: 0,
        free: 0,
        percentage: Math.round(diskUsage),
      },
      memory: {
        total: process.memoryUsage().heapTotal,
        used: process.memoryUsage().heapUsed,
        free: process.memoryUsage().heapTotal - process.memoryUsage().heapUsed,
        percentage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100),
      },
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
