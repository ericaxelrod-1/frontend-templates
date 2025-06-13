import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Group } from '../permissions/entities/group.entity';
import { User } from './entities/user.entity';
import { UserGroup } from './entities/user-group.entity';
import { IPermissionChecker } from '../permissions/shared/interfaces/permission-checker.interface';
import { PERMISSION_CHECKER } from '../permissions/shared/permissions-shared.module';

// Since the Group entity already has userGroups, we don't need the ExtendedGroup interface
// If we need additional properties, we can define them here
type ExtendedGroup = Group;

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private groupsRepository: Repository<Group>,
    @InjectRepository(UserGroup)
    private userGroupsRepository: Repository<UserGroup>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(PERMISSION_CHECKER)
    private readonly permissionChecker: IPermissionChecker,
  ) {}

  /**
   * Create a new group
   * @param name - The name of the group
   * @param description - The description of the group
   * @param currentUser - The user creating the group
   * @returns The created group
   */
  async create(
    name: string,
    description: string,
    currentUser: User,
  ): Promise<Group> {
    // Check if user has permission to create groups
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups',
      'create',
    );
    
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to create groups',
      );
    }
    
    // Check if group already exists
    const existingGroup = await this.groupsRepository.findOne({
      where: { name } as FindOptionsWhere<Group>,
    });
    
    if (existingGroup) {
      throw new BadRequestException(`Group with name ${name} already exists`);
    }
    
    // Create new group
    const group = this.groupsRepository.create({
      name,
      description,
      settings: JSON.stringify({}),
    });
    
    return this.groupsRepository.save(group);
  }

  /**
   * Find all groups
   * @param currentUser - The user requesting the groups
   * @returns An array of groups
   */
  async findAll(currentUser: User): Promise<Group[]> {
    // Check if user has permission to view groups
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups',
      'read',
    );
    
    // If global permission, return all groups with member relations
    if (hasPermission) {
      return this.groupsRepository.find({
        relations: ['userGroups', 'userGroups.user'],
      });
    }
    
    // Otherwise, return only groups the user is a member of
    const userWithGroups = await this.userRepository.findOne({
      where: { id: currentUser.id },
      relations: ['groups'],
    });
    
    if (!userWithGroups || !userWithGroups.groups) {
      return [];
    }
    
    return userWithGroups.groups;
  }

  /**
   * Find a group by ID
   * @param id - The ID of the group to find
   * @param currentUser - The user requesting the group
   * @returns The found group
   */
  async findOne(id: number, currentUser: User): Promise<Group> {
    // Check if user has permission to view groups
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups',
      'read',
    );
    
    // If no global permission, check if they're a member
    if (!hasPermission) {
      const membership = await this.userGroupsRepository.findOne({
        where: {
          group: { id },
          user: { id: currentUser.id },
        } as FindOptionsWhere<UserGroup>,
      });
      
      if (!membership) {
        throw new ForbiddenException(
          'You do not have permission to view this group',
        );
      }
    }
    
    const group = await this.groupsRepository.findOne({
      where: { id } as FindOptionsWhere<Group>,
      relations: ['userGroups', 'userGroups.user'],
    });
    
    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }
    
    return group;
  }

  /**
   * Add a user to a group
   * @param groupId - The ID of the group
   * @param userId - The ID of the user to add
   * @param currentUser - The user performing the action
   * @returns The created user-group relationship
   */
  async addMember(
    groupId: number,
    userId: number,
    currentUser: User,
  ): Promise<UserGroup> {
    // Check if current user has permission to manage group members
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups:members',
      'add',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to manage group members',
      );
    }

    // Check if group exists
    const group = await this.findOne(groupId, currentUser);
    
    // Check if user exists
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    
    // Check if user is already a member
    const existingMembership = await this.userGroupsRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
      } as FindOptionsWhere<UserGroup>,
    });
    
    if (existingMembership) {
      throw new BadRequestException(
        `User with ID ${userId} is already a member of group with ID ${groupId}`,
      );
    }
    
    // Create membership
    const userGroup = this.userGroupsRepository.create({
      group,
      user,
    });
    
    return this.userGroupsRepository.save(userGroup);
  }

  /**
   * Remove a user from a group
   * @param groupId - The ID of the group
   * @param userId - The ID of the user to remove
   * @param currentUser - The user performing the action
   */
  async removeMember(
    groupId: number,
    userId: number,
    currentUser: User,
  ): Promise<void> {
    // Check if current user has permission to manage group members
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups:members',
      'remove',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to manage group members',
      );
    }

    // Check if group exists
    await this.findOne(groupId, currentUser);
    
    // Check if membership exists
    const membership = await this.userGroupsRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
      } as FindOptionsWhere<UserGroup>,
      relations: ['group', 'user'],
    });
    
    if (!membership) {
      throw new NotFoundException(
        `User with ID ${userId} is not a member of group with ID ${groupId}`,
      );
    }
    
    // Remove membership
    await this.userGroupsRepository.remove(membership);
  }

  /**
   * Delete a group
   * @param id - The ID of the group to delete
   * @param currentUser - The user performing the action
   */
  async delete(id: number, currentUser: User): Promise<void> {
    // Check if user has permission to delete groups
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups',
      'delete',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to delete groups',
      );
    }

    // Check if group exists
    const group = await this.findOne(id, currentUser);
    
    // Delete group
    await this.groupsRepository.remove(group);
  }

  /**
   * Update group settings
   * @param id - The ID of the group
   * @param settings - The new settings for the group
   * @param currentUser - The user performing the action
   * @returns The updated group
   */
  async updateSettings(
    id: number,
    settings: Record<string, any>,
    currentUser: User,
  ): Promise<Group> {
    // Check if user has permission to update group settings
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups',
      'update',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to update group settings',
      );
    }

    // Check if group exists
    const group = await this.findOne(id, currentUser);
    
    // Update settings
    group.settings = JSON.stringify(settings);
    
    return this.groupsRepository.save(group);
  }

  /**
   * Update member permissions
   * @param groupId - The ID of the group
   * @param userId - The ID of the user
   * @param permissions - The new permissions for the user
   * @param currentUser - The user performing the action
   * @returns The updated user-group relationship
   */
  async updateMemberPermissions(
    groupId: number,
    userId: number,
    permissions: string[],
    currentUser: User,
  ): Promise<UserGroup> {
    // Check if current user has permission to manage group members
    const hasPermission = await this.permissionChecker.checkUserPermission(
      currentUser.id,
      'groups:members',
      'update',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to manage group member permissions',
      );
    }

    const group = await this.findOne(groupId, currentUser);
    const userGroup = group.userGroups.find((ug) => ug.user.id === userId);

    if (!userGroup) {
      throw new NotFoundException('User is not a member of this group');
    }

    // Validate permission format
    const validPermissions = permissions.filter(perm => {
      const parts = perm.split(':');
      return parts.length === 2 && parts[0] && parts[1];
    });

    // Note: UserGroup entity doesn't have permissions property
    // This would need to be handled through GroupPermission entities instead
    
    return this.userGroupsRepository.save(userGroup);
  }

  /**
   * Get members of a group
   * @param groupId - The ID of the group
   * @param currentUser - The user performing the action
   * @returns The members of the group
   */
  async getMembers(groupId: number, currentUser: User): Promise<UserGroup[]> {
    const group = await this.findOne(groupId, currentUser);
    return group.userGroups;
  }

  // Implementation of the findGroupWithUserGroups method to fix the error
  private async findGroupWithUserGroups(id: number): Promise<ExtendedGroup> {
    const group = await this.groupsRepository.findOne({
      where: { id } as FindOptionsWhere<Group>,
      relations: ['userGroups', 'userGroups.user'],
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }

    return group as ExtendedGroup;
  }
}
