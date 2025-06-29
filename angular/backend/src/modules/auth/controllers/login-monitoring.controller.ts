import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Delete,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { LoginAttemptService } from '../services/login-attempt.service';
import { IPReputationService } from '../services/ip-reputation.service';
import { CaptchaService } from '../services/captcha.service';
import { PatternDetectionService } from '../services/pattern-detection.service';
import { AlertService, AlertSeverity } from '../services/alert.service';
import { PermissionGuard } from '../../permissions/guards/permission.guard';
import { RequirePermission } from '../../permissions/decorators/require-permission.decorator';

@ApiTags('login-monitoring')
@Controller('login-monitoring')
export class LoginMonitoringController {
  constructor(
    private readonly loginAttemptService: LoginAttemptService,
    private readonly ipReputationService: IPReputationService,
    private readonly captchaService: CaptchaService,
    private readonly patternDetectionService: PatternDetectionService,
    private readonly alertService: AlertService,
  ) {}

  @Get('attempts/recent')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent login attempts with server-side sorting' })
  @ApiResponse({ status: 200, description: 'List of recent login attempts sorted by SQL ORDER BY' })
  async getRecentAttempts(
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
    @Query('email') email?: string,
    @Query('ipAddress') ipAddress?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const filters = {
      email,
      ipAddress,
      status,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      sortBy: sortBy || 'createdAt',
      sortDirection: sortDirection || 'desc',
    };
    
    const attempts = await this.loginAttemptService.getRecentAttemptsForDashboard(
      limit, 
      offset, 
      filters
    );
    
    // Get total count for pagination
    const total = await this.loginAttemptService.getTotalAttemptsCount({
      email,
      ipAddress,
      status,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
    
    return {
      items: attempts,
      total: total
    };
  }

  @Get('patterns/detect')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get both real-time and historical security patterns' })
  @ApiResponse({ status: 200, description: 'Combined pattern detection results (real-time + historical)' })
  async detectPatterns() {
    // Use enhanced detection that returns both real-time and historical patterns
    const patterns = await this.patternDetectionService.detectPatternsEnhanced();

    // Send alerts for any new real-time patterns detected
    const realTimePatterns = patterns.filter(p => !p.isHistorical);
    if (realTimePatterns.length > 0) {
      for (const pattern of realTimePatterns) {
        await this.alertService.sendPatternAlert(pattern);
      }
    }

    return patterns;
  }

  @Get('patterns/real-time')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get only real-time security patterns (active threats)' })
  @ApiResponse({ status: 200, description: 'Real-time pattern detection results' })
  async detectRealTimePatterns() {
    return await this.patternDetectionService.detectRealTimePatterns();
  }

  @Get('patterns/historical')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get historical security patterns from database' })
  @ApiResponse({ status: 200, description: 'Historical patterns from database' })
  async getHistoricalPatterns(@Query('limit') limit?: number) {
    return await this.patternDetectionService.getHistoricalPatterns(limit || 50);
  }

  @Post('patterns/test/:scenario')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create test login attempts to simulate attack patterns' })
  @ApiResponse({ status: 200, description: 'Test login attempts created successfully' })
  async createTestPattern(
    @Param('scenario') scenario: 'brute_force' | 'distributed_attack' | 'credential_stuffing' | 'account_switching',
  ) {
    await this.patternDetectionService.createTestLoginAttempts(scenario);
    
    // Wait a moment then run detection to see if patterns are found
    setTimeout(async () => {
      const detectedPatterns = await this.patternDetectionService.detectRealTimePatterns();
      console.log(`Test scenario '${scenario}' created. Detected patterns:`, detectedPatterns.length);
    }, 1000);

    return { 
      success: true, 
      message: `Test ${scenario} scenario created successfully. Check patterns in a few seconds.`,
      scenario: scenario
    };
  }

  @Delete('patterns/test-data')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clear test login attempt data' })
  @ApiResponse({ status: 200, description: 'Test data cleared successfully' })
  async clearTestData() {
    const result = await this.patternDetectionService.clearTestData();
    return { 
      success: true, 
      message: `Cleared ${result.deleted} test login attempts`,
      deletedCount: result.deleted
    };
  }

  @Get('ip/:ipAddress')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get IP reputation and history with aggregated data' })
  @ApiResponse({ status: 200, description: 'IP reputation data with aggregated statistics' })
  async getIPReputation(@Param('ipAddress') ipAddress: string) {
    const reputation = await this.ipReputationService.getOrCreate(ipAddress);
    const recentAttempts = await this.loginAttemptService.getRecentAttempts(ipAddress);

    // Get aggregated statistics for this IP
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const aggregatedStats = await this.loginAttemptService.getAggregatedStatsForIP(ipAddress, last24Hours);

    // Calculate reputation score based on recent activity
    const reputationScore = Math.max(0, 100 - (reputation.failedLoginAttempts * 10));

    // Find the most recent failed attempt for lastFailedAttempt
    const lastFailedAttempt = recentAttempts
      .filter(attempt => attempt.status === 'failed')
      .sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime())[0];

    return {
      ipAddress: reputation.ipAddress,
      failedAttempts: reputation.failedLoginAttempts,
      isBlocked: reputation.isBlocked,
      blockedUntil: reputation.blockedUntil,
      lastFailedAttempt: lastFailedAttempt?.attemptedAt,
      reputation: reputationScore,
      // Additional aggregated data
      stats: aggregatedStats,
      recentAttempts: recentAttempts.slice(0, 10), // Limit to last 10 attempts
    };
  }

  @Post('captcha/generate')
  @ApiOperation({ summary: 'Generate a CAPTCHA' })
  @ApiResponse({ status: 200, description: 'CAPTCHA data' })
  async generateCaptcha(@Body() data: { ipAddress: string; type?: string }) {
    const captcha = await this.captchaService.create(
      (data.type as any) || 'text',
      data.ipAddress,
    );

    // Don't return the solution in the response
    const { solution, ...captchaData } = captcha;

    return captchaData;
  }

  @Post('captcha/verify')
  @ApiOperation({ summary: 'Verify a CAPTCHA solution' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyCaptcha(@Body() data: { token: string; solution: string }) {
    const isValid = await this.captchaService.validate(
      data.token,
      data.solution,
    );
    return { valid: isValid };
  }

  @Post('alert/test')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Test the alert system' })
  @ApiResponse({ status: 200, description: 'Alert sent successfully' })
  async testAlert(
    @Body() data: { message: string; severity?: string },
    @Request() req,
  ) {
    const severity = (data.severity || 'medium') as AlertSeverity;

    const result = await this.alertService.sendAlert({
      title: 'Test Alert',
      message: data.message || 'This is a test alert',
      severity,
      timestamp: new Date(),
      userId: req.user?.id,
      data: { source: 'test', timestamp: new Date() },
    });

    return { success: result };
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get login statistics' })
  @ApiResponse({ status: 200, description: 'Login statistics' })
  async getStats(@Query('days') days: number = 7) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await this.loginAttemptService.getLoginAttemptStats({
      startDate,
      endDate,
    });

    return {
      timeframe: { startDate, endDate },
      ...stats,
    };
  }
}
