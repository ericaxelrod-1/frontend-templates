import {
  Controller,
  Get,
  Post,
  Param,
  Put,
  Patch,
  Delete,
  Body,
  UseGuards,
  Logger,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Role, SystemRoles } from './entities/role.entity';
import {
  UpdateRolePermissionsDto,
  UpdateRoleDto,
  AssignRoleDto,
  CreateRoleDto,
} from './dto/role.dto';
import { User } from './entities/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('roles')
export class RolesController {
  private readonly logger = new Logger(RolesController.name);

  constructor(private readonly rolesService: RolesService) { }

  @Get()
  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ status: 200, description: 'List of all roles (paginated)' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:view')
  findAll(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Query('search') search?: string,
  ): Promise<{ items: Role[]; total: number; page: number; pageSize: number }> {
    this.logger.debug('Getting all roles');
    return this.rolesService.findAll(
      page ? +page : 0,
      pageSize ? +pageSize : 10,
      sortBy || 'name',
      (sortDirection?.toUpperCase() as 'ASC' | 'DESC') || 'ASC',
      search || '',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get role by ID' })
  @ApiResponse({ status: 200, description: 'Role details', type: Role })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:view')
  findOne(@Param('id') id: number): Promise<Role> {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update role basic information' })
  @ApiResponse({
    status: 200,
    description: 'Role updated successfully',
    type: Role,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:update')
  update(
    @Param('id') id: number,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() currentUser: User,
  ): Promise<Role> {
    return this.rolesService.update(id, updateRoleDto, currentUser);
  }

  @Get('permissions/available')
  @ApiOperation({ summary: 'Get available permissions for roles' })
  @ApiResponse({ status: 200, description: 'List of available permissions' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:manage')
  getAvailablePermissions() {
    return {
      permissions: [
        {
          id: 'canCreateUsers',
          name: 'Create Users',
          description: 'Can create new users',
        },
        {
          id: 'canDeleteUsers',
          name: 'Delete Users',
          description: 'Can delete users',
        },
        {
          id: 'canEditUsers',
          name: 'Edit Users',
          description: 'Can edit user details',
        },
        {
          id: 'canViewAllUsers',
          name: 'View All Users',
          description: 'Can view all users in the system',
        },
        {
          id: 'canEmulateUsers',
          name: 'Emulate Users',
          description: 'Can login as another user',
        },
        {
          id: 'canManageGroups',
          name: 'Manage Groups',
          description: 'Can create, edit, and delete groups',
        },
        {
          id: 'canManageRoles',
          name: 'Manage Roles',
          description: 'Can manage roles and permissions',
        },
      ],
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({
    status: 201,
    description: 'Role created successfully',
    type: Role,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:create')
  create(
    @Body() createRoleDto: CreateRoleDto,
    @CurrentUser() currentUser: User,
  ): Promise<Role> {
    return this.rolesService.create(createRoleDto, currentUser);
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: 'Update role permissions' })
  @ApiResponse({
    status: 200,
    description: 'Role permissions updated',
    type: Role,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:update')
  updatePermissions(
    @Param('id') id: number,
    @Body() updateRolePermissionsDto: UpdateRolePermissionsDto,
    @CurrentUser() currentUser: User,
  ): Promise<Role> {
    return this.rolesService.updateRolePermissions(
      id,
      updateRolePermissionsDto.permissions,
      currentUser,
    );
  }

  @Put('users/:userId/role')
  @ApiOperation({ summary: 'Assign role to user' })
  @ApiResponse({
    status: 200,
    description: 'Role assigned to user',
    type: User,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission(['roles:assign', 'users:update'])
  assignRole(
    @Param('userId') userId: number,
    @Body() assignRoleDto: AssignRoleDto,
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    return this.rolesService.assignRoleToUser(
      userId,
      assignRoleDto.roleId,
      currentUser,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a role' })
  @ApiResponse({
    status: 200,
    description: 'Role deleted successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:delete')
  remove(
    @Param('id') id: number,
    @CurrentUser() currentUser: User,
  ): Promise<void> {
    return this.rolesService.remove(id, currentUser);
  }

  @Get(':id/ancestors')
  @ApiOperation({ summary: 'Get parent roles in the hierarchy' })
  @ApiResponse({ status: 200, description: 'List of ancestor roles' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:view')
  getAncestors(@Param('id') id: number): Promise<Role[]> {
    return this.rolesService.getAncestors(id);
  }

  @Get(':id/descendants')
  @ApiOperation({ summary: 'Get child roles in the hierarchy' })
  @ApiResponse({ status: 200, description: 'List of descendant roles' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:view')
  getDescendants(@Param('id') id: number): Promise<Role[]> {
    return this.rolesService.getDescendants(id);
  }

  @Get(':id/effective-permissions')
  @ApiOperation({ summary: 'Get resolved permissions with inheritance chain' })
  @ApiResponse({
    status: 200,
    description: 'Effective permissions with source information',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:view')
  getEffectivePermissions(@Param('id') id: number): Promise<
    Array<{
      permission: string;
      isGranted: boolean;
      source: string;
    }>
  > {
    return this.rolesService.getEffectivePermissions(id);
  }

  @Post(':id/validate-circular')
  @ApiOperation({
    summary: 'Validate that setting a new parent won\'t create circular reference',
  })
  @ApiResponse({ status: 200, description: 'Validation result' })
  @ApiResponse({ status: 400, description: 'Circular reference would be created' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:update')
  validateCircular(
    @Param('id') id: number,
    @Body() body: { newParentId: number },
  ): Promise<{ valid: boolean; message?: string }> {
    return this.rolesService
      .validateNoCircularReference(id, body.newParentId)
      .then(() => ({ valid: true }))
      .catch((error) => ({ valid: false, message: error.message }));
  }

  @Post(':id/validate-permissions')
  @ApiOperation({
    summary: 'Validate permission constraints before making changes',
  })
  @ApiResponse({ status: 200, description: 'Validation result with warnings' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:update')
  validatePermissions(
    @Param('id') id: number,
    @Body() body: { permissions: string[] },
  ): Promise<{ valid: boolean; warnings: string[] }> {
    return this.rolesService.validatePermissionConstraints(id, body.permissions);
  }

  @Get(':id/hierarchy')
  @ApiOperation({ summary: 'Get complete role hierarchy path' })
  @ApiResponse({ status: 200, description: 'Hierarchy path from root to role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:view')
  async getHierarchy(@Param('id') id: number): Promise<{
    ancestors: Role[];
    current: Role;
    descendants: Role[];
    effectivePermissions: Array<{ permission: string; isGranted: boolean; source: string }>;
  }> {
    const [ancestors, descendants, effectivePermissions] = await Promise.all([
      this.rolesService.getAncestors(id),
      this.rolesService.getDescendants(id),
      this.rolesService.getEffectivePermissions(id),
    ]);

    const current = await this.rolesService.findOne(id);

    return {
      ancestors,
      current,
      descendants,
      effectivePermissions,
    };
  }
}
