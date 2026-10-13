import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { Group } from '../permissions/entities/group.entity';
import { User } from './entities/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { GroupMembershipResult } from './dto/group-membership-result.dto';

// DTOs for the API
export class CreateGroupDto {
  name: string;
  description?: string;
}

export class UpdateGroupDto {
  name?: string;
  description?: string;
}

export class UpdateGroupSettingsDto {
  settings: any;
}

export class SetParentDto {
  parentId: number | null;
}

@ApiTags('groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
/**
 * Group membership IS the scope axis: `X-Active-Group-Id` is validated against
 * the caller's groups by rls-context.guard.ts, and the seeded frontend route
 * `/admin/groups` is already gated behind `groups:manage`. So the requirements
 * below are not new policy — they are the capability vocabulary that already
 * exists in `permissions`, finally stated on the handlers that were missing it.
 *
 * The names used, and why each is the one already in the seed data
 * (`src/database/seeds/permission-seeds.service.ts`, verified against db.sqlite):
 *
 *   groups:view    read the tree, its members and its hierarchy. The frontend
 *                  sidebar already gates the Groups nav item on this exact
 *                  string (sidebar.component.ts), so backend and frontend now
 *                  agree on one capability. Granted to Administrator and Super
 *                  Administrator; NOT to `user`.
 *   groups:create  groups:update  groups:delete   the three CRUD rows.
 *   groups:manage  the capability the seed gives the `admin` role for
 *                  membership and settings work, and the one that already gates
 *                  `GET /permissions/groups` and `PUT /permissions/groups/:id/
 *                  permissions` in PermissionsController. Used here for the four
 *                  handlers that change scope itself: addMember, removeMember,
 *                  updateSettings, setParent.
 *
 * DELIBERATELY NOT used: `groups:members:add`, `groups:members:remove`,
 * `groups:members:update`, `groups:members:view`, `groups:settings:update`.
 * Those rows exist in the seed and are more precise, but the guard destructures
 * the requirement with `const [resource, action] = permission.split(':')`
 * (permission.guard.ts:108) and then calls
 * `checkUserPermission(userId, resource, action)`, which rebuilds a TWO-part
 * name (permissions.service.ts:817). A three-part name therefore degrades to
 * `groups:members`, which no role holds, and would refuse everyone including
 * Super Administrator. The same truncation already affects `self:profile:read`
 * at users.controller.ts:100. `groups:manage` is the precise vocabulary that
 * survives that truncation; see the report for the guard-level fix.
 *
 * Every requirement is on its handler, never on the class: the guard
 * concatenates class and handler metadata and evaluates with OR
 * (permission.guard.ts:205-226), so a class-level requirement would widen all
 * thirteen handlers rather than narrow them.
 */
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:view')
  @Get()
  @ApiOperation({ summary: 'Get all groups' })
  @ApiResponse({
    status: 200,
    description: 'List of all groups (paginated)',
  })
  findAll(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Query('search') search?: string,
  ): Promise<{
    items: Group[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.groupsService.findAll(
      page ? +page : 0,
      pageSize ? +pageSize : 10,
      sortBy || 'name',
      (sortDirection?.toUpperCase() as 'ASC' | 'DESC') || 'ASC',
      search || '',
    );
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:view')
  @Get(':id')
  @ApiOperation({ summary: 'Get a group by ID' })
  @ApiResponse({
    status: 200,
    description: 'Group found',
    type: Group,
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Group> {
    return this.groupsService.findOne(id);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:create')
  @Post()
  @ApiOperation({ summary: 'Create a new group' })
  @ApiResponse({
    status: 201,
    description: 'Group created successfully',
    type: Group,
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

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:update')
  @Put(':id')
  @ApiOperation({ summary: 'Update a group' })
  @ApiResponse({
    status: 200,
    description: 'Group updated successfully',
    type: Group,
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateGroupDto: UpdateGroupDto,
    @CurrentUser() currentUser: User,
  ): Promise<Group> {
    return this.groupsService.update(
      id,
      updateGroupDto.name,
      updateGroupDto.description,
      currentUser,
    );
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a group' })
  @ApiResponse({
    status: 200,
    description: 'Group deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  delete(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: User,
  ): Promise<void> {
    return this.groupsService.delete(id, currentUser);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:view')
  @Get(':id/members')
  @ApiOperation({ summary: 'Get all group members' })
  @ApiResponse({
    status: 200,
    description: 'List of group members',
    type: [User],
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  getMembers(@Param('id', ParseIntPipe) groupId: number): Promise<User[]> {
    return this.groupsService.getMembers(groupId);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:manage')
  @Post(':id/members/:userId')
  @ApiOperation({ summary: 'Add a member to the group' })
  @ApiResponse({
    status: 201,
    description: 'Member added successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Group or user not found',
  })
  @ApiResponse({
    status: 403,
    description: 'User is already a member',
  })
  addMember(
    @Param('id', ParseIntPipe) groupId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<GroupMembershipResult> {
    return this.groupsService.addMember(groupId, userId);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:manage')
  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from the group' })
  @ApiResponse({
    status: 200,
    description: 'Member removed successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Group, user, or membership not found',
  })
  removeMember(
    @Param('id', ParseIntPipe) groupId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<GroupMembershipResult> {
    return this.groupsService.removeMember(groupId, userId);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:manage')
  @Put(':id/settings')
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
    @Param('id', ParseIntPipe) id: number,
    @Body() updateGroupSettingsDto: UpdateGroupSettingsDto,
    @CurrentUser() currentUser: User,
  ): Promise<Group> {
    return this.groupsService.updateSettings(
      id,
      updateGroupSettingsDto.settings,
      currentUser,
    );
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:view')
  @Get(':id/ancestors')
  @ApiOperation({ summary: 'Get all ancestor groups' })
  @ApiResponse({
    status: 200,
    description: 'List of ancestor groups',
    type: [Group],
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  getAncestors(@Param('id', ParseIntPipe) id: number): Promise<Group[]> {
    return this.groupsService.getAncestors(id);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:view')
  @Get(':id/descendants')
  @ApiOperation({ summary: 'Get all descendant groups' })
  @ApiResponse({
    status: 200,
    description: 'List of descendant groups',
    type: [Group],
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  getDescendants(@Param('id', ParseIntPipe) id: number): Promise<Group[]> {
    return this.groupsService.getDescendants(id);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:view')
  @Get(':id/hierarchy-path')
  @ApiOperation({ summary: 'Get hierarchy path from root to this group' })
  @ApiResponse({
    status: 200,
    description: 'Hierarchy path from root to group',
    type: [Group],
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  getHierarchyPath(@Param('id', ParseIntPipe) id: number): Promise<Group[]> {
    return this.groupsService.getHierarchyPath(id);
  }

  @UseGuards(PermissionGuard)
  @RequirePermission('groups:manage')
  @Put(':id/parent')
  @ApiOperation({ summary: 'Set parent group' })
  @ApiResponse({
    status: 200,
    description: 'Parent group set successfully',
    type: Group,
  })
  @ApiResponse({ status: 404, description: 'Group or parent not found' })
  @ApiResponse({
    status: 400,
    description: 'Invalid parent (circular reference or self-reference)',
  })
  setParent(
    @Param('id', ParseIntPipe) id: number,
    @Body() setParentDto: SetParentDto,
  ): Promise<Group> {
    return this.groupsService.setParent(id, setParentDto.parentId);
  }
}
