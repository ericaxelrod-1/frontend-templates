import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Create a new user (admin only)' })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires admin privileges',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('users:create')
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @ApiOperation({ summary: 'Get all users (admin only)' })
  @ApiResponse({ status: 200, description: 'List of all users' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires admin privileges',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('users:view')
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @ApiOperation({ summary: 'Search for users' })
  @ApiResponse({ status: 200, description: 'List of matching users' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires admin privileges',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('users:view')
  @Get('search')
  search(@Query('q') query: string) {
    return this.usersService.searchUsers(query || '');
  }

  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return this.usersService.findOne(req.user.id);
  }

  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires appropriate privileges',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(['users:view', 'self:profile:read'])
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() currentUser) {
    // Users with only self:profile:read can only view their own profile
    const hasGeneralUserAccess = await this.usersService.checkUserHasPermission(
      currentUser.id,
      'users',
      'view',
    );

    if (!hasGeneralUserAccess && currentUser.id !== +id) {
      throw new ForbiddenException('You can only view your own profile');
    }

    return this.usersService.findOne(+id);
  }

  @ApiOperation({ summary: 'Update user by ID' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires appropriate privileges',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission(['users:update', 'self:profile:update'])
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser,
  ) {
    // Check if user has general user update permission
    const hasUserUpdatePermission =
      await this.usersService.checkUserHasPermission(
        currentUser.id,
        'users',
        'update',
      );

    // If user only has self:profile:update permission
    if (!hasUserUpdatePermission) {
      // Regular users can only update their own profile
      if (currentUser.id !== +id) {
        throw new ForbiddenException('You can only update your own profile');
      }

      // Regular users cannot update their role
      if (updateUserDto.roleIds && updateUserDto.roleIds.length > 0) {
        throw new ForbiddenException('Regular users cannot update their role');
      }
    } else {
      // Check if the user has admin-level permissions
      const hasAdminPermission = await this.usersService.checkUserHasPermission(
        currentUser.id,
        'users',
        'admin',
      );

      if (!hasAdminPermission) {
        // Non-admin users with users:update cannot update superadmins
        const userToUpdate = await this.usersService.findOne(+id);
        const isSuperAdmin = await this.usersService.checkUserHasPermission(
          userToUpdate.id,
          'system',
          'admin',
        );

        if (isSuperAdmin) {
          throw new ForbiddenException(
            'You cannot update users with system admin privileges',
          );
        }
      }
    }

    return this.usersService.update(+id, updateUserDto);
  }

  @ApiOperation({ summary: 'Delete user by ID' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires admin privileges',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('users:delete')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() currentUser) {
    // Check if user has admin-level permissions
    const hasAdminPermission = await this.usersService.checkUserHasPermission(
      currentUser.id,
      'system',
      'admin',
    );

    if (!hasAdminPermission) {
      // Non-admin users cannot delete superadmins
      const userToDelete = await this.usersService.findOne(+id);
      const isSuperAdmin = await this.usersService.checkUserHasPermission(
        userToDelete.id,
        'system',
        'admin',
      );

      if (isSuperAdmin) {
        throw new ForbiddenException(
          'You cannot delete users with system admin privileges',
        );
      }
    }

    return this.usersService.remove(+id);
  }
}
