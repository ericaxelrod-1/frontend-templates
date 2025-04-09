import { Controller, Get, Post, Body, Param, Delete, UseGuards, Put, Query, HttpStatus, HttpException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsService } from './permissions.service';
import { Permission } from './entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { PermissionGuard } from '../../auth/guards/permission.guard';

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @RequirePermissions({ resource: 'permission', action: 'create' })
  @ApiOperation({ summary: 'Create a new permission' })
  @ApiResponse({ status: 201, description: 'Permission created successfully', type: Permission })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async create(@Body() createPermissionDto: CreatePermissionDto): Promise<Permission> {
    try {
      return await this.permissionsService.create(createPermissionDto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error creating permission',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  @Get()
  @RequirePermissions({ resource: 'permission', action: 'read' })
  @ApiOperation({ summary: 'Get all permissions' })
  @ApiResponse({ status: 200, description: 'Returns all permissions', type: [Permission] })
  async findAll(): Promise<Permission[]> {
    return await this.permissionsService.findAll();
  }

  @Get('user')
  @ApiOperation({ summary: 'Get current user permissions' })
  @ApiResponse({ status: 200, description: 'Returns current user permissions' })
  async getCurrentUserPermissions(@Query('resource') resource?: string): Promise<any> {
    try {
      // The user ID is extracted from the JWT in the permission service
      return await this.permissionsService.getCurrentUserPermissions(resource);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error retrieving user permissions',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':id')
  @RequirePermissions({ resource: 'permission', action: 'read' })
  @ApiOperation({ summary: 'Get a permission by ID' })
  @ApiResponse({ status: 200, description: 'Returns the permission', type: Permission })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async findOne(@Param('id') id: string): Promise<Permission> {
    const permission = await this.permissionsService.findOne(+id);
    if (!permission) {
      throw new HttpException('Permission not found', HttpStatus.NOT_FOUND);
    }
    return permission;
  }

  @Get('role/:roleId')
  @RequirePermissions({ resource: 'role', action: 'read' })
  @ApiOperation({ summary: 'Get permissions for a role' })
  @ApiResponse({ status: 200, description: 'Returns the role permissions', type: [Permission] })
  async findByRole(@Param('roleId') roleId: string): Promise<Permission[]> {
    return await this.permissionsService.findByRole(+roleId);
  }

  @Get('group/:groupId')
  @RequirePermissions({ resource: 'group', action: 'read' })
  @ApiOperation({ summary: 'Get permissions for a group' })
  @ApiResponse({ status: 200, description: 'Returns the group permissions', type: [Permission] })
  async findByGroup(@Param('groupId') groupId: string): Promise<Permission[]> {
    return await this.permissionsService.findByGroup(+groupId);
  }

  @Get('resource/:resource')
  @RequirePermissions({ resource: 'permission', action: 'read' })
  @ApiOperation({ summary: 'Get permissions by resource' })
  @ApiResponse({ status: 200, description: 'Returns permissions for the resource', type: [Permission] })
  async findByResource(@Param('resource') resource: string): Promise<Permission[]> {
    return await this.permissionsService.findByResource(resource);
  }

  @Put(':id')
  @RequirePermissions({ resource: 'permission', action: 'update' })
  @ApiOperation({ summary: 'Update a permission' })
  @ApiResponse({ status: 200, description: 'Permission updated successfully', type: Permission })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async update(
    @Param('id') id: string,
    @Body() updatePermissionDto: UpdatePermissionDto
  ): Promise<Permission> {
    try {
      return await this.permissionsService.update(+id, updatePermissionDto);
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Permission not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error.message || 'Error updating permission',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  @Delete(':id')
  @RequirePermissions({ resource: 'permission', action: 'delete' })
  @ApiOperation({ summary: 'Delete a permission' })
  @ApiResponse({ status: 200, description: 'Permission deleted successfully' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async remove(@Param('id') id: string): Promise<void> {
    try {
      await this.permissionsService.remove(+id);
    } catch (error) {
      if (error.status === HttpStatus.NOT_FOUND) {
        throw new HttpException('Permission not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error.message || 'Error deleting permission',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('assign/role')
  @RequirePermissions({ resource: 'permission', action: 'manage' })
  @ApiOperation({ summary: 'Assign permissions to a role' })
  @ApiResponse({ status: 200, description: 'Permissions assigned successfully' })
  async assignToRole(
    @Body() data: { roleId: number; permissionIds: number[] }
  ): Promise<void> {
    try {
      await this.permissionsService.assignToRole(data.roleId, data.permissionIds);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error assigning permissions to role',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  @Post('assign/group')
  @RequirePermissions({ resource: 'permission', action: 'manage' })
  @ApiOperation({ summary: 'Assign permissions to a group' })
  @ApiResponse({ status: 200, description: 'Permissions assigned successfully' })
  async assignToGroup(
    @Body() data: { groupId: number; permissionIds: number[] }
  ): Promise<void> {
    try {
      await this.permissionsService.assignToGroup(data.groupId, data.permissionIds);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error assigning permissions to group',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  @Post('assign/user')
  @RequirePermissions({ resource: 'permission', action: 'manage' })
  @ApiOperation({ summary: 'Assign direct permissions to a user' })
  @ApiResponse({ status: 200, description: 'Permissions assigned successfully' })
  async assignToUser(
    @Body() data: { userId: number; permissions: { permissionId: number; granted: boolean }[] }
  ): Promise<void> {
    try {
      await this.permissionsService.assignToUser(data.userId, data.permissions);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error assigning permissions to user',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  @Delete('remove/role')
  @RequirePermissions({ resource: 'permission', action: 'manage' })
  @ApiOperation({ summary: 'Remove permissions from a role' })
  @ApiResponse({ status: 200, description: 'Permissions removed successfully' })
  async removeFromRole(
    @Body() data: { roleId: number; permissionIds: number[] }
  ): Promise<void> {
    try {
      await this.permissionsService.removeFromRole(data.roleId, data.permissionIds);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error removing permissions from role',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  @Delete('remove/group')
  @RequirePermissions({ resource: 'permission', action: 'manage' })
  @ApiOperation({ summary: 'Remove permissions from a group' })
  @ApiResponse({ status: 200, description: 'Permissions removed successfully' })
  async removeFromGroup(
    @Body() data: { groupId: number; permissionIds: number[] }
  ): Promise<void> {
    try {
      await this.permissionsService.removeFromGroup(data.groupId, data.permissionIds);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error removing permissions from group',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  @Delete('remove/user')
  @RequirePermissions({ resource: 'permission', action: 'manage' })
  @ApiOperation({ summary: 'Remove direct permissions from a user' })
  @ApiResponse({ status: 200, description: 'Permissions removed successfully' })
  async removeFromUser(
    @Body() data: { userId: number; permissionIds: number[] }
  ): Promise<void> {
    try {
      await this.permissionsService.removeFromUser(data.userId, data.permissionIds);
    } catch (error) {
      throw new HttpException(
        error.message || 'Error removing permissions from user',
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }
} 