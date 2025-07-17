import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { LoginAttemptService } from '../services/login-attempt.service';
import { PermissionGuard } from '../../permissions/guards/permission.guard';
import { RequirePermission } from '../../permissions/decorators/require-permission.decorator';

@ApiTags('login-attempts')
@Controller('login-attempts')
export class LoginAttemptsController {
  constructor(
    private readonly loginAttemptService: LoginAttemptService,
  ) {}

  @Get('attempts')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get recent login attempts with server-side sorting',
  })
  @ApiResponse({
    status: 200,
    description: 'List of recent login attempts sorted by SQL ORDER BY',
  })
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

    const attempts =
      await this.loginAttemptService.getRecentAttemptsForDashboard(
        limit,
        offset,
        filters,
      );

    return attempts;
  }

  @Get('statistics')
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