import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from '../../modules/permissions/permissions.service';
import { RequirePermission, RequireAllPermissions } from '../../modules/permissions/decorators';
import { PermissionGuard } from '../../modules/permissions/guards';
import { JwtAuthGuard } from '../../modules/auth/guards';
import { User } from '../../modules/users/entities/user.entity';
import { GetUser } from '../../modules/auth/decorators';

// Example DTO for demonstration purposes
class ResourceDto {
  id?: number;
  name: string;
  description?: string;
}

/**
 * Example controller demonstrating how to use the permission system
 * This is for demonstration purposes only
 */
@Controller('api/resources')
@UseGuards(JwtAuthGuard) // Ensure user is authenticated
export class ResourceController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * List all resources - requires 'resources:list' permission
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('resources:list')
  async findAll(@GetUser() user: User) {
    // Method implementation would go here
    return [
      { id: 1, name: 'Resource 1', description: 'First resource' },
      { id: 2, name: 'Resource 2', description: 'Second resource' },
    ];
  }

  /**
   * Get a specific resource - requires 'resources:read' permission
   */
  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('resources:read')
  async findOne(@Param('id') id: string, @GetUser() user: User) {
    // Method implementation would go here
    return { id: parseInt(id), name: `Resource ${id}`, description: `Description for resource ${id}` };
  }

  /**
   * Create a new resource - requires 'resources:create' permission
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('resources:create')
  async create(@Body() resourceDto: ResourceDto, @GetUser() user: User) {
    // Method implementation would go here
    return {
      id: Math.floor(Math.random() * 1000),
      ...resourceDto
    };
  }

  /**
   * Update a resource - requires 'resources:update' permission
   */
  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('resources:update')
  async update(@Param('id') id: string, @Body() resourceDto: ResourceDto, @GetUser() user: User) {
    // Method implementation would go here
    return {
      id: parseInt(id),
      ...resourceDto
    };
  }

  /**
   * Delete a resource - requires BOTH 'resources:delete' AND 'admin:access' permissions
   */
  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequireAllPermissions(['resources:delete', 'admin:access'])
  async remove(@Param('id') id: string, @GetUser() user: User) {
    // Method implementation would go here
    return { message: `Resource ${id} has been deleted` };
  }

  /**
   * Example of programmatic permission check
   * This endpoint requires 'resources:manage' OR ownership of the resource
   */
  @Put(':id/special-action')
  @UseGuards(JwtAuthGuard) // Only authenticate, manual permission check
  async specialAction(@Param('id') id: string, @GetUser() user: User) {
    const resourceId = parseInt(id);
    
    // First check if user has admin permission
    const hasManagePermission = await this.permissionsService.checkUserPermission(
      user.id,
      'resources', 
      'manage'
    );
    
    // If not, check if user is the owner (example business logic)
    const isOwner = await this.checkResourceOwnership(resourceId, user.id);
    
    // Only allow if user has permission OR is the owner
    if (!hasManagePermission && !isOwner) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    
    // Method implementation would go here
    return { 
      message: `Special action performed on resource ${id}`,
      performedBy: hasManagePermission ? 'ADMIN' : 'OWNER' 
    };
  }
  
  /**
   * Example of hierarchical permission check with multiple resources
   */
  @Get(':id/analytics')
  @UseGuards(JwtAuthGuard) // Only authenticate, manual permission check
  async getResourceAnalytics(@Param('id') id: string, @GetUser() user: User) {
    // Check for read permission on resources
    const canReadResource = await this.permissionsService.checkUserPermission(
      user.id,
      'resources', 
      'read'
    );
    
    if (!canReadResource) {
      throw new ForbiddenException('You do not have permission to view this resource');
    }
    
    // Check for analytics permission
    const canAccessAnalytics = await this.permissionsService.checkUserPermission(
      user.id,
      'analytics', 
      'access'
    );
    
    if (!canAccessAnalytics) {
      throw new ForbiddenException('You do not have permission to view analytics');
    }
    
    // Method implementation would go here
    return { 
      resourceId: parseInt(id),
      analytics: {
        views: 1250,
        interactions: 85,
        conversionRate: 0.034
      }
    };
  }
  
  // Helper method to check if a user owns a resource (example)
  private async checkResourceOwnership(resourceId: number, userId: number): Promise<boolean> {
    // In a real implementation, this would query the database
    // to check if the resource belongs to the user
    return resourceId % 2 === 0; // For demonstration: even IDs are "owned" by the user
  }
} 