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
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

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
