import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { IPReputationService } from '../services/ip-reputation.service';
import { LoginAttemptService } from '../services/login-attempt.service';
import { PermissionGuard } from '../../permissions/guards/permission.guard';
import { RequirePermission } from '../../permissions/decorators/require-permission.decorator';

@ApiTags('ip-reputation')
@Controller('ip-reputation')
export class IpReputationController {
  constructor(
    private readonly ipReputationService: IPReputationService,
    private readonly loginAttemptService: LoginAttemptService,
  ) {}

  @Get('reputation/:ipAddress')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get IP reputation and history with aggregated data',
  })
  @ApiResponse({
    status: 200,
    description: 'IP reputation data with aggregated statistics',
  })
  async getIPReputation(@Param('ipAddress') ipAddress: string) {
    const reputation = await this.ipReputationService.getOrCreate(ipAddress);
    const recentAttempts =
      await this.loginAttemptService.getRecentAttempts(ipAddress);

    // Get aggregated statistics for this IP
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const aggregatedStats =
      await this.loginAttemptService.getAggregatedStatsForIP(
        ipAddress,
        last24Hours,
      );

    // Calculate reputation score based on recent activity
    const reputationScore = Math.max(
      0,
      100 - reputation.failedLoginAttempts * 10,
    );

    // Find the most recent failed attempt for lastFailedAttempt
    const lastFailedAttempt = recentAttempts
      .filter((attempt) => attempt.status === 'failed')
      .sort(
        (a, b) =>
          new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime(),
      )[0];

    return {
      ipAddress: reputation.ipAddress,
      failedAttempts: reputation.failedLoginAttempts,
      isBlocked: reputation.isBlocked,
      blockedUntil: reputation.blockedUntil,
      lastFailedAttempt: lastFailedAttempt?.attemptedAt,
      reputation: reputationScore,
      recentAttempts: recentAttempts.slice(0, 10), // Last 10 attempts
      aggregatedStats,
    };
  }
} 