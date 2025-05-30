import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
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
  @ApiOperation({ summary: 'Get recent login attempts' })
  @ApiResponse({ status: 200, description: 'List of recent login attempts' })
  async getRecentAttempts(
    @Query('limit') limit: number = 50,
    @Query('email') email?: string,
  ) {
    // This is a placeholder implementation that would be replaced with proper logic
    // In a real implementation, you would query the database for recent attempts
    return { message: 'Recent login attempts would be returned here' };
  }

  @Get('patterns/detect')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Run pattern detection manually' })
  @ApiResponse({ status: 200, description: 'Pattern detection results' })
  async detectPatterns() {
    const patterns = await this.patternDetectionService.detectPatterns();

    // Send alerts for any detected patterns
    if (patterns.length > 0) {
      for (const pattern of patterns) {
        await this.alertService.sendPatternAlert(pattern);
      }
    }

    return patterns;
  }

  @Get('ip/:ipAddress')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get IP reputation and history' })
  @ApiResponse({ status: 200, description: 'IP reputation data' })
  async getIPReputation(@Param('ipAddress') ipAddress: string) {
    const reputation = await this.ipReputationService.getOrCreate(ipAddress);
    const recentAttempts =
      await this.loginAttemptService.getRecentAttempts(ipAddress);

    return {
      reputation,
      recentAttempts,
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
