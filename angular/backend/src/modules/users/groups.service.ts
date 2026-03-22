import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
import { User } from './entities/user.entity';
import { Group } from '../permissions/entities/group.entity';
import { GroupMembershipResult } from './dto/group-membership-result.dto';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(Group) private groupRepository: Repository<Group>,
  ) {}

  async findAll(
    page = 0,
    pageSize = 10,
    sortBy = 'name',
    sortDirection: 'ASC' | 'DESC' = 'ASC',
    search = '',
  ): Promise<{
    items: Group[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const skip = page * pageSize;
    const take = pageSize;

    const [items, total] = await this.groupRepository.findAndCount({
      where: search
        ? [
            { name: ILike(`%${search}%`) },
            { description: ILike(`%${search}%`) },
          ]
        : {},
      relations: ['users', 'owner'],
      order: { [sortBy]: sortDirection },
      skip,
      take,
    });

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: number): Promise<Group> {
    const group = await this.groupRepository.findOne({
      where: { id },
      relations: ['users', 'owner'],
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }

    return group;
  }

  async create(
    name: string,
    description?: string,
    currentUser?: User,
  ): Promise<Group> {
    const group = this.groupRepository.create({
      name,
      description,
      ownerId: currentUser?.id,
    });

    const savedGroup = await this.groupRepository.save(group);

    // Load relations for consistency with other endpoints (findAll, findOne)
    return this.groupRepository.findOne({
      where: { id: savedGroup.id },
      relations: ['users', 'owner'],
    });
  }

  async update(
    id: number,
    name?: string,
    description?: string,
    currentUser?: User,
  ): Promise<Group> {
    const group = await this.findOne(id);

    // Basic permission check - only owner or system admin can update
    if (currentUser && group.ownerId !== currentUser.id) {
      const isAdmin = currentUser.roles?.some((role) => role.name === 'admin');
      if (!isAdmin) {
        throw new NotFoundException(
          'Only the group owner or admin can update this group',
        );
      }
    }

    if (name !== undefined) group.name = name;
    if (description !== undefined) group.description = description;

    return this.groupRepository.save(group);
  }

  async delete(id: number, currentUser?: User): Promise<void> {
    const group = await this.findOne(id);

    // Basic permission check - only owner or system admin can delete
    if (currentUser && group.ownerId !== currentUser.id) {
      const isAdmin = currentUser.roles?.some((role) => role.name === 'admin');
      if (!isAdmin) {
        throw new NotFoundException(
          'Only the group owner or admin can delete this group',
        );
      }
    }

    // Prevent deletion of system groups
    if (group.isSystemGroup) {
      throw new NotFoundException('System groups cannot be deleted');
    }

    await this.groupRepository.remove(group);
  }

  async getMembers(groupId: number): Promise<User[]> {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['users'],
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    return group.users || [];
  }

  async addMember(
    groupId: number,
    userId: number,
  ): Promise<GroupMembershipResult> {
    this.logger.debug(`Adding user ${userId} to group ${groupId}`);

    // Fetch user with current groups
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['groups'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Fetch group
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['users'],
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    // Check if user is already a member
    const wasAlreadyMember =
      user.groups?.some((g) => g.id === groupId) || false;

    if (wasAlreadyMember) {
      this.logger.warn(
        `User ${userId} is already a member of group ${groupId}`,
      );
      return {
        success: false,
        operation: 'added',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        group: {
          id: group.id,
          name: group.name,
          description: group.description,
        },
        timestamp: new Date(),
        message: `User is already a member of group ${group.name}`,
        previousState: {
          wasAlreadyMember: true,
          memberSince: undefined, // Could be enhanced to track join dates
        },
        currentState: {
          isMember: true,
          memberSince: undefined,
          totalGroupMembers: group.users?.length || 0,
        },
      };
    }

    // Add user to group
    if (!user.groups) {
      user.groups = [];
    }
    user.groups.push(group);

    // Save the updated user
    await this.userRepository.save(user);

    // Get updated group member count
    const updatedGroup = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['users'],
    });

    this.logger.log(`Successfully added user ${userId} to group ${groupId}`);

    return {
      success: true,
      operation: 'added',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
      },
      timestamp: new Date(),
      message: `User successfully added to group ${group.name}`,
      previousState: {
        wasAlreadyMember: false,
      },
      currentState: {
        isMember: true,
        memberSince: new Date(),
        totalGroupMembers: updatedGroup?.users?.length || 0,
      },
    };
  }

  async removeMember(
    groupId: number,
    userId: number,
  ): Promise<GroupMembershipResult> {
    this.logger.debug(`Removing user ${userId} from group ${groupId}`);

    // Fetch user with current groups
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['groups'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Fetch group
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['users'],
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    // Check if user is a member
    const wasAlreadyMember =
      user.groups?.some((g) => g.id === groupId) || false;

    if (!wasAlreadyMember) {
      this.logger.warn(`User ${userId} is not a member of group ${groupId}`);
      return {
        success: false,
        operation: 'removed',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        group: {
          id: group.id,
          name: group.name,
          description: group.description,
        },
        timestamp: new Date(),
        message: `User is not a member of group ${group.name}`,
        previousState: {
          wasAlreadyMember: false,
        },
        currentState: {
          isMember: false,
          memberSince: undefined,
          totalGroupMembers: group.users?.length || 0,
        },
      };
    }

    // Remove user from group
    user.groups = user.groups?.filter((g) => g.id !== groupId) || [];

    // Save the updated user
    await this.userRepository.save(user);

    // Get updated group member count
    const updatedGroup = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['users'],
    });

    this.logger.log(
      `Successfully removed user ${userId} from group ${groupId}`,
    );

    return {
      success: true,
      operation: 'removed',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
      },
      timestamp: new Date(),
      message: `User successfully removed from group ${group.name}`,
      previousState: {
        wasAlreadyMember: true,
      },
      currentState: {
        isMember: false,
        memberSince: undefined,
        totalGroupMembers: updatedGroup?.users?.length || 0,
      },
    };
  }

  async updateSettings(
    id: number,
    settings: any,
    currentUser?: User,
  ): Promise<Group> {
    const group = await this.findOne(id);

    // Basic permission check - only owner or system admin can update settings
    if (currentUser && group.ownerId !== currentUser.id) {
      const isAdmin = currentUser.roles?.some((role) => role.name === 'admin');
      if (!isAdmin) {
        throw new NotFoundException(
          'Only the group owner or admin can update group settings',
        );
      }
    }

    group.settings = JSON.stringify(settings);
    return this.groupRepository.save(group);
  }

  async getAncestors(groupId: number): Promise<Group[]> {
    const ancestors: Group[] = [];
    let currentGroup = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ['parent'],
    });

    while (currentGroup?.parent) {
      ancestors.push(currentGroup.parent);
      currentGroup = await this.groupRepository.findOne({
        where: { id: currentGroup.parent.id },
        relations: ['parent'],
      });
    }

    return ancestors;
  }

  async getDescendants(groupId: number): Promise<Group[]> {
    const descendants: Group[] = [];
    const queue = [groupId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = await this.groupRepository.find({
        where: { parentId: currentId },
      });

      for (const child of children) {
        descendants.push(child);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  async getHierarchyPath(groupId: number): Promise<Group[]> {
    const ancestors = await this.getAncestors(groupId);
    const group = await this.findOne(groupId);
    return [...ancestors.reverse(), group];
  }

  async validateNoCircularReference(
    groupId: number,
    newParentId: number,
  ): Promise<boolean> {
    if (groupId === newParentId) {
      throw new BadRequestException('A group cannot be its own parent');
    }

    let currentId: number | null = newParentId;
    const visited = new Set<number>([groupId]);

    while (currentId !== null) {
      if (visited.has(currentId)) {
        throw new BadRequestException(
          'Setting this parent would create a circular reference',
        );
      }

      visited.add(currentId);
      const parent = await this.groupRepository.findOne({
        where: { id: currentId },
        relations: ['parent'],
      });

      currentId = parent?.parent?.id ?? null;
    }

    return true;
  }

  async setParent(groupId: number, parentId: number | null): Promise<Group> {
    const group = await this.findOne(groupId);

    if (parentId !== null) {
      await this.validateNoCircularReference(groupId, parentId);
    }

    group.parentId = parentId;
    return this.groupRepository.save(group);
  }

  async getEffectiveMembers(groupId: number): Promise<User[]> {
    const allMemberIds = new Set<number>();

    const groupIds = [
      groupId,
      ...(await this.getDescendants(groupId)).map((g) => g.id),
    ];

    for (const id of groupIds) {
      const group = await this.groupRepository.findOne({
        where: { id },
        relations: ['users'],
      });
      group?.users?.forEach((user) => allMemberIds.add(user.id));
    }

    if (allMemberIds.size === 0) {
      return [];
    }

    return this.userRepository.find({
      where: { id: In([...allMemberIds]) },
    });
  }
}
