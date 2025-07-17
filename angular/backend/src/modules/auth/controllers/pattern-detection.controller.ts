import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
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
import { PatternDetectionService } from '../services/pattern-detection.service';
import { PermissionGuard } from '../../permissions/guards/permission.guard';
import { RequirePermission } from '../../permissions/decorators/require-permission.decorator';
import { PatternSummaryDto } from '../dto/pattern-summary.dto';
import { PatternSummaryQueryDto } from '../dto/pattern-summary-query.dto';

@ApiTags('pattern-detection')
@Controller('pattern-detection')
export class PatternDetectionController {
  constructor(
    private readonly patternDetectionService: PatternDetectionService,
  ) {}

  @Get('patterns')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get security patterns with unified data source and optional filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Security patterns with pagination and filtering',
  })
  async getPatterns(
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
    @Query('status') status?: string,
    @Query('patternType') patternType?: string,
    @Query('severity') severity?: string,
    @Query('ipAddress') ipAddress?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Query('search') search?: string,
  ) {
    const filters = {
      status,
      patternType,
      severity,
      ipAddress,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      sortBy: sortBy || 'detectionTimestamp',
      sortDirection: sortDirection || 'desc',
      search,
    };

    return await this.patternDetectionService.getPatterns(
      limit,
      offset,
      filters,
    );
  }

  @Get('patterns/summary')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get pattern type summary for dashboard tiles',
  })
  @ApiResponse({
    status: 200,
    description: 'Pattern type summary with counts and severity distribution',
    type: [PatternSummaryDto],
  })
  async getPatternSummary(
    @Query() query: PatternSummaryQueryDto,
  ): Promise<PatternSummaryDto[]> {
    const { dateFrom, dateTo, timeRange } = query;

    const startDate = dateFrom ? new Date(dateFrom) : undefined;
    const endDate = dateTo ? new Date(dateTo) : undefined;

    const summary = await this.patternDetectionService.getPatternSummary(
      startDate,
      endDate,
      timeRange,
    );

    return summary.map((item) => ({
      patternType: item.patternType,
      displayName: item.displayName,
      count: item.count,
      severity: item.severity,
      lastDetected: item.lastDetected,
      percentage: item.percentage,
    }));
  }

  @Post('patterns/test/:scenario')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create test login attempts to simulate attack patterns',
  })
  @ApiResponse({
    status: 200,
    description: 'Test login attempts created successfully',
  })
  async createTestPattern(
    @Param('scenario')
    scenario:
      | 'brute_force'
      | 'distributed_attack'
      | 'credential_stuffing'
      | 'account_switching'
      | 'ip_hopping'
      | 'suspicious_location'
      | 'time_anomaly',
  ) {
    // Create test login attempts
    await this.patternDetectionService.createTestLoginAttempts(scenario);

    // FIXED: Race condition - immediately run detection and storage synchronously
    const detectedPatterns =
      await this.patternDetectionService.detectAndStorePatterns();
    console.log(
      `Test scenario '${scenario}' created. Detected and stored patterns:`,
      detectedPatterns.length,
    );

    return {
      success: true,
      message: `Test ${scenario} scenario created successfully. ${detectedPatterns.length} patterns detected and stored.`,
      scenario: scenario,
      patternsDetected: detectedPatterns.length,
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
      message: `Cleared ${result.deleted} test login attempts and ${result.patternsDeleted} test patterns`,
      deletedCount: result.deleted,
      patternsDeletedCount: result.patternsDeleted,
    };
  }
} 