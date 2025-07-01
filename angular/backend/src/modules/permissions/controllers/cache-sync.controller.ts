import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { ManifestService } from '../scanners/manifest.service';
import { CacheSyncService } from '../../cache/cache-sync.service';
import { ComponentScannerService } from '../scanners/component-scanner.service';
import { RouteScannerService } from '../scanners/route-scanner.service';
import { EndpointScannerService } from '../scanners/endpoint-scanner.service';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('cache-sync')
@ApiBearerAuth()
@Controller('cache-sync')
@UseGuards(JwtAuthGuard)
export class CacheSyncController {
  constructor(
    private readonly manifestService: ManifestService,
    private readonly cacheSyncService: CacheSyncService,
    private readonly componentScannerService: ComponentScannerService,
    private readonly routeScannerService: RouteScannerService,
    private readonly endpointScannerService: EndpointScannerService,
  ) {}

  /**
   * Trigger a scan of all components, routes, and endpoints
   */
  @Post('scan')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:manage')
  @ApiOperation({
    summary: 'Scan components, routes, and endpoints for permissions',
  })
  async scanAll() {
    const manifest = await this.manifestService.generateManifest();
    return {
      success: true,
      stats: {
        components: manifest.components.components.length,
        routes: manifest.routes.routes.length,
        endpoints: manifest.endpoints.endpoints.length,
        generated: manifest.generated,
      },
    };
  }

  /**
   * Get the current permission manifest
   */
  @Get('manifest')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get the current permission manifest' })
  async getManifest() {
    return this.manifestService.getManifest();
  }

  /**
   * Force synchronization of the permission cache
   */
  @Post('sync')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:manage')
  @ApiOperation({ summary: 'Force synchronization of permission cache' })
  async forceSynchronization() {
    await this.cacheSyncService.syncAllPermissions();
    return {
      success: true,
      message: 'Cache synchronization completed successfully',
    };
  }

  /**
   * Get the current synchronization status
   */
  @Get('status')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get current synchronization status' })
  async getSyncStatus() {
    return {
      success: true,
      message: 'Cache sync service is available',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Scan UI components only
   */
  @Post('scan/components')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:manage')
  @ApiOperation({ summary: 'Scan UI components for permissions' })
  async scanComponents() {
    const components = await this.componentScannerService.scanComponents();
    return {
      success: true,
      components: components.components.length,
      generated: components.generated,
    };
  }

  /**
   * Scan routes only
   */
  @Post('scan/routes')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:manage')
  @ApiOperation({ summary: 'Scan routes for permissions' })
  async scanRoutes() {
    const routes = await this.routeScannerService.scanRoutes();
    return {
      success: true,
      routes: routes.routes.length,
      generated: routes.generated,
    };
  }

  /**
   * Scan endpoints only
   */
  @Post('scan/endpoints')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:manage')
  @ApiOperation({ summary: 'Scan API endpoints for permissions' })
  async scanEndpoints() {
    const endpoints = await this.endpointScannerService.scanEndpoints();
    return {
      success: true,
      endpoints: endpoints.endpoints.length,
      generated: endpoints.generated,
    };
  }
}
