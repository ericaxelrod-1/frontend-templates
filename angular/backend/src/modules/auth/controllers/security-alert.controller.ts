import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionGuard } from '../../permissions/guards/permission.guard';
import { RequirePermission } from '../../permissions/decorators/require-permission.decorator';
import { SecurityAlertService } from '../services/security-alert.service';
import { UsersService } from '../../users/users.service';
import {
  AcknowledgeAlertDto,
  ResolveAlertDto,
  CreateAlertDto,
  AlertFiltersDto,
  BlockUserDto,
} from '../dto/alert.dto';

@ApiTags('security-alerts')
@Controller('security-alerts')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiBearerAuth()
export class SecurityAlertController {
  constructor(
    private readonly securityAlertService: SecurityAlertService,
    private readonly usersService: UsersService,
  ) {}

  @Get('alerts')
  @RequirePermission('login-monitoring:read')
  @ApiOperation({ summary: 'Get security alerts with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'List of security alerts' })
  async getSecurityAlerts(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('alertType') alertType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const filters = {
      status,
      severity,
      alertType,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      sortBy: sortBy || 'createdAt',
      sortDirection: sortDirection || 'desc',
    };

    return this.securityAlertService.getSecurityAlerts(
      limit || 50,
      offset || 0,
      filters,
    );
  }

  @Post('alerts/:id/acknowledge')
  @RequirePermission('login-monitoring:manage')
  @ApiOperation({ summary: 'Acknowledge a security alert' })
  @ApiResponse({ status: 200, description: 'Alert acknowledged successfully' })
  @ApiParam({ name: 'id', type: Number })
  async acknowledgeAlert(
    @Param('id', ParseIntPipe) alertId: number,
    @Body() acknowledgeDto: AcknowledgeAlertDto,
    @Request() req,
  ) {
    const alert = await this.securityAlertService.acknowledgeAlert(alertId, req.user.id);
    return { success: true, message: 'Alert acknowledged successfully', alert };
  }

  @Post('alerts/:id/resolve')
  @RequirePermission('login-monitoring:manage')
  @ApiOperation({ summary: 'Resolve a security alert' })
  @ApiResponse({ status: 200, description: 'Alert resolved successfully' })
  @ApiParam({ name: 'id', type: Number })
  async resolveAlert(
    @Param('id', ParseIntPipe) alertId: number,
    @Body() resolveDto: ResolveAlertDto,
    @Request() req,
  ) {
    const alert = await this.securityAlertService.resolveAlert(alertId, req.user.id, resolveDto.notes);
    return { success: true, message: 'Alert resolved successfully', alert };
  }

  @Post('alerts/:id/dismiss')
  @RequirePermission('login-monitoring:manage')
  @ApiOperation({ summary: 'Dismiss a security alert' })
  @ApiResponse({ status: 200, description: 'Alert dismissed successfully' })
  @ApiParam({ name: 'id', type: Number })
  async dismissAlert(
    @Param('id', ParseIntPipe) alertId: number,
    @Request() req,
  ) {
    const alert = await this.securityAlertService.dismissAlert(alertId, req.user.id);
    return { success: true, message: 'Alert dismissed successfully', alert };
  }

  @Post('users/:id/block')
  @RequirePermission('users:manage')
  @ApiOperation({ summary: 'Block a user account' })
  @ApiResponse({ status: 200, description: 'User blocked successfully' })
  @ApiParam({ name: 'id', type: Number })
  async blockUser(
    @Param('id', ParseIntPipe) userId: number,
    @Body() blockDto: BlockUserDto,
    @Request() req,
  ) {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const blockedUntil = blockDto.durationHours && blockDto.durationHours > 0
      ? new Date(Date.now() + blockDto.durationHours * 60 * 60 * 1000)
      : null;

    await this.usersService.blockUser(userId, {
      reason: blockDto.reason,
      blockedUntil,
      blockedBy: req.user.id,
    });

    return { success: true, message: 'User blocked successfully' };
  }

  @Put('users/:id/unblock')
  @RequirePermission('users:manage')
  @ApiOperation({ summary: 'Unblock a user account' })
  @ApiResponse({ status: 200, description: 'User unblocked successfully' })
  @ApiParam({ name: 'id', type: Number })
  async unblockUser(
    @Param('id', ParseIntPipe) userId: number,
    @Request() req,
  ) {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (!user.isBlocked) {
      throw new HttpException('User is not blocked', HttpStatus.BAD_REQUEST);
    }

    await this.usersService.unblockUser(userId, req.user.id);

    return { success: true, message: 'User unblocked successfully' };
  }
}
