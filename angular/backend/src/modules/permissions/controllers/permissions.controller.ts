import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Patch,
  Req,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import {
  RequirePermission,
  RequireAllPermissions,
} from '../decorators/require-permission.decorator';
import { PermissionsService } from '../services/permissions.service';
import { Permission } from '../entities/permission.entity';
import { Resource } from '../entities/resource.entity';
import { Action } from '../entities/action.entity';
import { User } from '../../users/entities/user.entity';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { ManifestService } from '../scanners/manifest.service';
import { ComponentScannerService } from '../scanners/component-scanner.service';
import { RouteScannerService } from '../scanners/route-scanner.service';
import { EndpointScannerService } from '../scanners/endpoint-scanner.service';
import { CacheSyncService } from '../../cache/cache-sync.service';
import { FastifyRequest } from 'fastify';
import { UiComponent } from '../entities/ui-component.entity';
import { FrontendRoute } from '../entities/frontend-route.entity';
import { ApiEndpoint } from '../entities/api-endpoint.entity';

interface AuthenticatedRequest extends FastifyRequest {
  user?: { id: number; email: string };
}

// DTOs for permission management
class CreatePermissionDto {
  resourceName: string;
  actionName: string;
  name?: string;
  description?: string;
}

class UpdatePermissionDto {
  description?: string;
}

class PermissionResponseDto {
  id: string;
  resourceName: string;
  actionName: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

class PermissionCheckResponseDto {
  hasPermission: boolean;
}

class UserPermissionUpdateDto {
  granted: boolean;
}

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
@UseGuards(JwtAuthGuard)
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly manifestService: ManifestService,
    private readonly componentScannerService: ComponentScannerService,
    private readonly routeScannerService: RouteScannerService,
    private readonly endpointScannerService: EndpointScannerService,
    private readonly cacheSyncService: CacheSyncService,
  ) {}

  // Permission check endpoint
  @Get('check/:resource/:action')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Check if the authenticated user has a specific permission',
  })
  @ApiParam({ name: 'resource', description: 'Resource name' })
  @ApiParam({ name: 'action', description: 'Action name' })
  @ApiResponse({
    status: 200,
    description: 'Permission check result',
    type: PermissionCheckResponseDto,
  })
  async checkPermission(
    @Param('resource') resource: string,
    @Param('action') action: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PermissionCheckResponseDto> {
    // The subject is the caller. Always.
    //
    // This handler used to accept a caller-supplied `?userId=`, and that made
    // it a disclosure oracle rather than a self-check: `resource` and `action`
    // are caller-controlled and so was the subject, so sweeping
    // `(userId, resource, action)` recovers the entire permission matrix of
    // the user table — one boolean per cell, and a 403-free way to learn who is
    // privileged before attempting anything. The Postgres tree reached the same
    // conclusion about `has_permission(who, ...)` and banned it from
    // request-handling code for exactly this reason.
    //
    // "Does user N hold permission P" is a legitimate question, so it is not
    // dropped — it moves to `PermissionInspectorController`, which answers it
    // behind `permissions:view` for callers entitled to ask about other
    // people. `GET /permissions/user-permissions` remains the bulk form of the
    // self-check.
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }

    return {
      hasPermission: await this.permissionsService.checkUserPermission(
        userId,
        resource,
        action,
      ),
    };
  }

  // Get all permissions
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:list')
  @ApiOperation({ summary: 'Get all permissions' })
  @ApiResponse({
    status: 200,
    description: 'List of all permissions',
    type: [PermissionResponseDto],
  })
  async findAll(): Promise<Permission[]> {
    return this.permissionsService.findAll();
  }

  /**
   * Get permissions for the current user
   * This endpoint must be placed before @Get(':id') to avoid route conflicts
   */
  @Get('user-permissions')
  @ApiOperation({ summary: 'Get permissions for the current user' })
  @ApiResponse({
    status: 200,
    description: 'List of user permissions',
    type: [String],
  })
  @ApiResponse({ status: 401, description: 'User not authenticated' })
  async getUserPermissions(@Req() req: AuthenticatedRequest): Promise<string[]> {
    // userId comes from the authenticated user, never from the caller
    const userId = req.user?.['id'];
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.permissionsService.getUserPermissions(userId);
  }

  // Get permission by ID
  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get permission by ID' })
  @ApiParam({ name: 'id', description: 'Permission ID' })
  @ApiResponse({
    status: 200,
    description: 'Permission details',
    type: PermissionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<Permission> {
    const permission = await this.permissionsService.findById(id);
    if (!permission) {
      throw new NotFoundException(`Permission with ID ${id} not found`);
    }
    return permission;
  }

  // Create permission
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:create')
  @ApiOperation({ summary: 'Create a new permission' })
  @ApiResponse({
    status: 201,
    description: 'Permission created',
    type: PermissionResponseDto,
  })
  async create(
    @Body() createPermissionDto: CreatePermissionDto,
  ): Promise<Permission> {
    // If name is not provided, generate it from resourceName and actionName
    if (!createPermissionDto.name) {
      createPermissionDto.name = `${createPermissionDto.resourceName}:${createPermissionDto.actionName}`;
    }

    return this.permissionsService.create(createPermissionDto);
  }

  // Update permission
  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:update')
  @ApiOperation({ summary: 'Update a permission' })
  @ApiParam({ name: 'id', description: 'Permission ID' })
  @ApiResponse({
    status: 200,
    description: 'Permission updated',
    type: PermissionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePermissionDto: UpdatePermissionDto,
  ): Promise<Permission> {
    const updated = await this.permissionsService.update(
      id,
      updatePermissionDto,
    );
    if (!updated) {
      throw new NotFoundException(`Permission with ID ${id} not found`);
    }
    return updated;
  }

  // Delete permission
  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:delete')
  @ApiOperation({ summary: 'Delete a permission' })
  @ApiParam({ name: 'id', description: 'Permission ID' })
  @ApiResponse({ status: 200, description: 'Permission deleted' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.permissionsService.delete(id);
  }

  // Get all resources
  @Get('resources/all')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get all resources' })
  async getAllResources() {
    return this.permissionsService.findAllResources();
  }

  // Get all actions
  @Get('actions/all')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get all actions' })
  async getAllActions() {
    return this.permissionsService.findAllActions();
  }

  // Update user permission
  @Put('user/:userId/permission/:permissionId')
  @UseGuards(PermissionGuard)
  @RequireAllPermissions(['permissions:manage', 'users:manage'])
  @ApiOperation({ summary: 'Update a user permission' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiParam({ name: 'permissionId', description: 'Permission ID' })
  async updateUserPermission(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
    @Body() updateDto: { granted: boolean },
  ) {
    return this.permissionsService.updateUserPermission(
      userId,
      permissionId,
      updateDto.granted,
    );
  }

  // Get role permissions
  @Get('role/:roleId')
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:manage')
  @ApiOperation({ summary: 'Get permissions for a role' })
  @ApiParam({ name: 'roleId', description: 'Role ID' })
  async getRolePermissions(@Param('roleId', ParseIntPipe) roleId: number) {
    return this.permissionsService.getRolePermissions(roleId);
  }

  // Update role permission
  @Put('role/:roleId/permission/:permissionId')
  @UseGuards(PermissionGuard)
  @RequireAllPermissions(['permissions:manage', 'roles:manage'])
  @ApiOperation({ summary: 'Update a role permission' })
  @ApiParam({ name: 'roleId', description: 'Role ID' })
  @ApiParam({ name: 'permissionId', description: 'Permission ID' })
  async updateRolePermission(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
    @Body() updateDto: { granted: boolean },
  ) {
    return this.permissionsService.updateRolePermission(
      roleId,
      permissionId,
      updateDto.granted,
    );
  }

  // Get group permissions
  @Get('group/:groupId')
  @UseGuards(PermissionGuard)
  @RequirePermission('groups:manage')
  @ApiOperation({ summary: 'Get permissions for a group' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  async getGroupPermissions(@Param('groupId', ParseIntPipe) groupId: number) {
    return this.permissionsService.getGroupPermissions(groupId);
  }

  // Update group permission
  @Put('group/:groupId/permission/:permissionId')
  @UseGuards(PermissionGuard)
  @RequireAllPermissions(['permissions:manage', 'groups:manage'])
  @ApiOperation({ summary: 'Update a group permission' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  @ApiParam({ name: 'permissionId', description: 'Permission ID' })
  async updateGroupPermission(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
    @Body() updateDto: { granted: boolean },
  ) {
    return this.permissionsService.updateGroupPermission(
      groupId,
      permissionId,
      updateDto.granted,
    );
  }

  /**
   * Get all UI components with their permissions
   */
  @Get('components')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  async getAllComponents() {
    return this.permissionsService.getAllComponents();
  }

  /**
   * Get a specific UI component by ID
   */
  @Get('component/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get a specific UI component by ID' })
  @ApiParam({ name: 'id', description: 'Component ID' })
  @ApiResponse({
    status: 200,
    description: 'Component details',
    type: PermissionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Component not found' })
  async getComponentById(@Param('id') id: string) {
    const component = await this.permissionsService.getComponentById(id);
    if (!component) {
      throw new NotFoundException(`Component with ID ${id} not found`);
    }
    return component;
  }

  /**
   * Update a UI component's permissions
   */
  @Put('components/:id/permissions')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:update')
  @ApiOperation({ summary: 'Update component permissions' })
  @ApiParam({ name: 'id', description: 'Component ID' })
  async updateComponentPermissions(
    @Param('id') id: string,
    @Body('permissions') permissions: string[],
  ): Promise<UiComponent> {
    return this.permissionsService.updateComponentPermissions(
      id,
      permissions,
      false,
    );
  }

  /**
   * Get all routes with their permissions
   */
  @Get('routes')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  async getAllRoutes() {
    return this.permissionsService.getAllRoutes();
  }

  /**
   * Get a specific route by ID
   */
  @Get('route/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get a specific route by ID' })
  @ApiParam({ name: 'id', description: 'Route ID' })
  @ApiResponse({
    status: 200,
    description: 'Route details',
    type: PermissionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Route not found' })
  async getRouteById(@Param('id') id: string) {
    const route = await this.permissionsService.getRouteById(id);
    if (!route) {
      throw new NotFoundException(`Route with ID ${id} not found`);
    }
    return route;
  }

  /**
   * Update a route's permissions
   */
  @Put('routes/:id/permissions')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:update')
  @ApiOperation({ summary: 'Update route permissions' })
  @ApiParam({ name: 'id', description: 'Route ID' })
  async updateRoutePermissions(
    @Param('id') id: string,
    @Body('permissions') permissions: string[],
  ): Promise<FrontendRoute> {
    return this.permissionsService.updateRoutePermissions(
      id,
      permissions,
      false,
    );
  }

  /**
   * Test if the current user can access a specific route
   */
  @Get('route-access-test/:id')
  @UseGuards(JwtAuthGuard)
  async testRouteAccess(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.['id'];
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return {
      hasAccess: await this.permissionsService.canUserAccessRoute(userId, id),
    };
  }

  /**
   * Get all API endpoints with their permissions
   */
  @Get('endpoints')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  async getAllEndpoints() {
    return this.permissionsService.getAllEndpoints();
  }

  /**
   * Get a specific API endpoint by ID
   */
  @Get('endpoint/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  @ApiOperation({ summary: 'Get a specific API endpoint by ID' })
  @ApiParam({ name: 'id', description: 'Endpoint ID' })
  @ApiResponse({
    status: 200,
    description: 'Endpoint details',
    type: PermissionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  async getEndpointById(@Param('id') id: string) {
    const endpoint = await this.permissionsService.getEndpointById(id);
    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID ${id} not found`);
    }
    return endpoint;
  }

  /**
   * Update an API endpoint's permissions
   */
  @Put('endpoints/:id/permissions')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:update')
  @ApiOperation({ summary: 'Update endpoint permissions' })
  @ApiParam({ name: 'id', description: 'Endpoint ID' })
  async updateEndpointPermissions(
    @Param('id') id: string,
    @Body('permissions') permissions: string[],
  ): Promise<ApiEndpoint> {
    return this.permissionsService.updateEndpointPermissions(
      id,
      permissions,
      false,
    );
  }

  /**
   * Test if the current user can access a specific API endpoint
   */
  @Get('endpoint-access-test/:id')
  @UseGuards(JwtAuthGuard)
  async testEndpointAccess(
    @Param('id') id: string,
    @Query('method') method: string = 'GET',
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.['id'];
    if (!userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return {
      hasAccess: await this.permissionsService.canUserAccessEndpoint(
        userId,
        id,
        method,
      ),
    };
  }

  /**
   * Synchronize permissions from code to database
   */
  @Post('sync')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:refresh')
  async syncPermissions(
    @Body() body: { type?: 'components' | 'routes' | 'endpoints' | 'all' },
  ) {
    const type = body.type || 'all';

    switch (type) {
      case 'components':
        await this.componentScannerService.scanComponents();
        break;
      case 'routes':
        await this.routeScannerService.scanRoutes();
        break;
      case 'endpoints':
        await this.endpointScannerService.scanEndpoints();
        break;
      case 'all':
        await this.manifestService.generateManifest();
        break;
    }

    // Sync the cache after updating the database
    await this.cacheSyncService.syncAllPermissions();

    return {
      message: `Successfully synchronized ${type} permissions.`,
    };
  }

  /**
   * Get the permission manifest
   */
  @Get('manifest')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:view')
  async getManifest() {
    return this.manifestService.getManifest();
  }

  @Post('seed')
  @UseGuards(PermissionGuard)
  @RequirePermission('permissions:refresh')
  @ApiOperation({
    summary: 'Seed default permissions (requires permissions:refresh)',
  })
  @ApiResponse({
    status: 200,
    description: 'Default permissions seeded successfully',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async seedDefaultPermissions() {
    await this.permissionsService.seedDefaultPermissions();

    return {
      success: true,
      message: 'Default permissions seeded successfully',
    };
  }
}
