import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Group } from './entities/group.entity';
import { UserGroup } from './entities/user-group.entity';
import {
  CreateGroupDto,
  UpdateGroupSettingsDto,
  UpdateMemberPermissionsDto,
} from './dto/group.dto';
import { User } from './entities/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';

@ApiTags('groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @RequirePermission('groups:create')
  @ApiOperation({ summary: 'Create a new group' })
  @ApiResponse({
    status: 201,
    description: 'Group created successfully',
    type: Group,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  create(
    @Body() createGroupDto: CreateGroupDto,
    @CurrentUser() currentUser: User,
  ): Promise<Group> {
    return this.groupsService.create(
      createGroupDto.name,
      createGroupDto.description,
      currentUser,
    );
  }

  @Get()
  @RequirePermission(['groups:read', 'groups:list'])
  @ApiOperation({ summary: 'Get all accessible groups' })
  @ApiResponse({
    status: 200,
    description: 'List of accessible groups',
    type: [Group],
  })
  findAll(@CurrentUser() currentUser: User): Promise<Group[]> {
    return this.groupsService.findAll(currentUser);
  }

  @Get(':id')
  @RequirePermission(['groups:read', 'groups:view'])
  @ApiOperation({ summary: 'Get group by ID' })
  @ApiResponse({ status: 200, description: 'Group details', type: Group })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  findOne(
    @Param('id') id: number,
    @CurrentUser() currentUser: User,
  ): Promise<Group> {
    return this.groupsService.findOne(id, currentUser);
  }

  @Post(':id/members/:userId')
  @RequirePermission(['groups:manage', 'groups:members:add'])
  @ApiOperation({ summary: 'Add member to group' })
  @ApiResponse({
    status: 201,
    description: 'Member added successfully',
    type: UserGroup,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - user already in group',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Group or user not found' })
  addMember(
    @Param('id') groupId: number,
    @Param('userId') userId: number,
    @CurrentUser() currentUser: User,
  ): Promise<UserGroup> {
    return this.groupsService.addMember(groupId, userId, currentUser);
  }

  @Delete(':id/members/:userId')
  @RequirePermission(['groups:manage', 'groups:members:remove'])
  @ApiOperation({ summary: 'Remove member from group' })
  @ApiResponse({ status: 200, description: 'Member removed successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({
    status: 404,
    description: 'Group, user, or membership not found',
  })
  removeMember(
    @Param('id') groupId: number,
    @Param('userId') userId: number,
    @CurrentUser() currentUser: User,
  ): Promise<void> {
    return this.groupsService.removeMember(groupId, userId, currentUser);
  }

  @Delete(':id')
  @RequirePermission(['groups:delete', 'groups:manage'])
  @ApiOperation({ summary: 'Delete group' })
  @ApiResponse({ status: 200, description: 'Group deleted successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  delete(
    @Param('id') id: number,
    @CurrentUser() currentUser: User,
  ): Promise<void> {
    return this.groupsService.delete(id, currentUser);
  }

  @Put(':id/settings')
  @RequirePermission(['groups:settings:update', 'groups:manage'])
  @ApiOperation({ summary: 'Update group settings' })
  @ApiResponse({
    status: 200,
    description: 'Group settings updated successfully',
    type: Group,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  updateSettings(
    @Param('id') id: number,
    @Body() updateGroupSettingsDto: UpdateGroupSettingsDto,
    @CurrentUser() currentUser: User,
  ): Promise<Group> {
    return this.groupsService.updateSettings(
      id,
      updateGroupSettingsDto.settings,
      currentUser,
    );
  }

  @Put(':id/members/:userId')
  @RequirePermission(['groups:members:update', 'groups:manage'])
  @ApiOperation({ summary: 'Update member permissions' })
  @ApiResponse({
    status: 200,
    description: 'Member permissions updated successfully',
    type: UserGroup,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({
    status: 404,
    description: 'Group, user, or membership not found',
  })
  updateMemberPermissions(
    @Param('id') groupId: number,
    @Param('userId') userId: number,
    @Body() updateMemberPermissionsDto: UpdateMemberPermissionsDto,
    @CurrentUser() currentUser: User,
  ): Promise<UserGroup> {
    return this.groupsService.updateMemberPermissions(
      groupId,
      userId,
      updateMemberPermissionsDto.permissions,
      currentUser,
    );
  }

  @Get(':id/members')
  @RequirePermission(['groups:members:read', 'groups:read', 'groups:view'])
  @ApiOperation({ summary: 'Get all group members' })
  @ApiResponse({
    status: 200,
    description: 'List of group members',
    type: [UserGroup],
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  getMembers(
    @Param('id') groupId: number,
    @CurrentUser() currentUser: User,
  ): Promise<UserGroup[]> {
    return this.groupsService.getMembers(groupId, currentUser);
  }
}
