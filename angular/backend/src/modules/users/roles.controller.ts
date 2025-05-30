import {
  Controller,
  Get,
  Post,
  Param,
  Put,
  Body,
  UseGuards,
  Logger,
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

  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ status: 200, description: 'List of all roles', type: [Role] })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:read')
  findAll(): Promise<Role[]> {
    this.logger.debug('Getting all roles');
    return this.rolesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get role by ID' })
  @ApiResponse({ status: 200, description: 'Role details', type: Role })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @UseGuards(PermissionGuard)
  @RequirePermission('roles:read')
  findOne(@Param('id') id: number): Promise<Role> {
    return this.rolesService.findOne(id);
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
}
