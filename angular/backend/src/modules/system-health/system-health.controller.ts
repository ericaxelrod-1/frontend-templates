import {
  Controller,
  Get,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  SystemHealthService,
  HealthStatus,
} from '../system/services/system-health.service';
import { PrivacyTicketService } from '../privacy/privacy-ticket.service';
import { PrivacyCleanupService } from '../privacy/privacy-cleanup.service';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

/**
 * The wire status is Title Case because the frontend's status switch matches on
 * it exactly — the previous `NORMAL -> 'Healthy', WARNING -> 'WARNING'` mix meant
 * the UI never recognised a Warning or a Critical.
 */
const STATUS_LABELS: Record<HealthStatus, string> = {
  [HealthStatus.NORMAL]: 'Healthy',
  [HealthStatus.WARNING]: 'Warning',
  [HealthStatus.CRITICAL]: 'Critical',
  [HealthStatus.PANIC]: 'Panic',
  [HealthStatus.UNKNOWN]: 'Unknown',
};

@ApiTags('system-health')
@ApiBearerAuth()
@Controller('admin/system-health')
// Reading host resource state is not a member capability: `system:health` exists
// for exactly this page and is granted to the Administrator role.
//
// There is deliberately NO class-level @RequirePermission here. PermissionGuard
// concatenates handler metadata with controller metadata into one array and
// evaluates it with OR logic, so a class-level `system:health` beside a handler
// `system:manage` resolves to "system:health OR system:manage" — which lets the
// read-only permission delete files. Each handler therefore states its own
// requirement, which is the only value the guard sees. The spec asserts that
// every handler carries one, so a future route cannot default to open.
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class SystemHealthController {
  constructor(
    private readonly healthService: SystemHealthService,
    private readonly privacyTicketService: PrivacyTicketService,
    private readonly privacyCleanupService: PrivacyCleanupService,
  ) {}

  @Get()
  @RequirePermission('system:health')
  @ApiOperation({
    summary: 'Current Sentinel snapshot: disk, memory and queue depth',
  })
  @ApiResponse({
    status: 200,
    description: 'The measured snapshot, including thresholds and last error',
  })
  @ApiResponse({
    status: 403,
    description: 'Missing the system:health permission',
  })
  async getHealth() {
    const snapshot = this.healthService.getSnapshot();
    const [activeJobs, pendingTickets] = await Promise.all([
      this.privacyTicketService.countActiveJobs(),
      this.privacyTicketService.countPendingTickets(),
    ]);

    return {
      status: STATUS_LABELS[snapshot.status],
      disk: {
        total: snapshot.disk.total,
        used: snapshot.disk.used,
        free: snapshot.disk.free,
        percentage: Math.round(snapshot.disk.percentage),
      },
      memory: {
        total: snapshot.memory.total,
        used: snapshot.memory.used,
        free: snapshot.memory.free,
        percentage: Math.round(snapshot.memory.percentage),
      },
      process: snapshot.memory.process,
      activeJobs,
      pendingTickets,
      // Null only if the very first check has not completed yet; the previous
      // implementation returned the response time here, which is a different
      // fact from "when the Sentinel last looked".
      lastCheck: snapshot.lastCheckedAt,
      lastError: snapshot.lastError,
      guardDisabled: snapshot.guardDisabled,
      thresholds: snapshot.thresholds,
    };
  }

  @Post('clear-temp')
  @HttpCode(HttpStatus.OK)
  // Deleting files is not a read: it takes system:manage, which is the
  // permission the seed data already reserved for system maintenance.
  //
  // This REPLACES the class-level system:health rather than adding to it. The
  // brief considered @RequireAllPermissions(['system:health','system:manage'])
  // here; that was rejected because system:manage is meant to be the strictly
  // stronger capability, and ANDing would deny an operator who holds
  // system:manage alone. PermissionGuard also discards the controller
  // permission outright when a handler uses `all` (:186-203), so the list would
  // have to name system:health by hand for the read gate to survive.
  @RequirePermission('system:manage')
  @ApiOperation({
    summary:
      'Delete finished privacy exports that are past their retention window',
  })
  @ApiResponse({
    status: 200,
    description:
      'How many files were scanned, removed and how much space was freed',
  })
  @ApiResponse({
    status: 403,
    description: 'Missing the system:manage permission',
  })
  async clearTemp() {
    const result = await this.privacyCleanupService.purgeExpiredExports();

    return {
      message: 'Cleanup complete',
      scannedFiles: result.scannedFiles,
      removedFiles: result.removedFiles,
      freedBytes: result.freedBytes,
      errors: result.errors,
    };
  }
}
