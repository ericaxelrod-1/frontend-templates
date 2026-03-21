import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere, In } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RoleMembershipResult } from './dto/role-membership-result.dto';
import { PasswordValidationService } from '../auth/password-validation.service';
import * as bcrypt from 'bcrypt';
import { PermissionsService } from '../permissions/services/permissions.service';
import { Group } from '../permissions/entities/group.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @Inject(forwardRef(() => PasswordValidationService))
    private readonly passwordValidationService: PasswordValidationService,
    @Inject(forwardRef(() => PermissionsService))
    private readonly permissionsService: PermissionsService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    // Check if email already exists
    const existingUserByEmail = await this.userRepository.findOne({
      where: { email: createUserDto.email },
    });

    if (existingUserByEmail) {
      throw new ConflictException('Email already exists');
    }

    // Check if username already exists
    const existingUserByUsername = await this.userRepository.findOne({
      where: { username: createUserDto.username },
    });

    if (existingUserByUsername) {
      throw new ConflictException('Username already exists');
    }

    // Validate password if provided
    if (createUserDto.password) {
      this.passwordValidationService.validate(createUserDto.password);
      createUserDto.password = await bcrypt.hash(createUserDto.password, 10);
    }

    // Handle roles
    let roles: Role[] = [];
    if (createUserDto.roleIds && createUserDto.roleIds.length > 0) {
      roles = await this.roleRepository.find({
        where: { id: In(createUserDto.roleIds) },
      });

      if (roles.length !== createUserDto.roleIds.length) {
        throw new BadRequestException('One or more role IDs are invalid');
      }
    } else {
      // If no roles provided, use default role
      const defaultRole = await this.roleRepository.findOne({
        where: { isDefault: true },
      });

      if (!defaultRole) {
        throw new BadRequestException('Default role not found');
      }

      roles = [defaultRole];
    }

    // Handle groups
    let groups: Group[] = [];
    if (createUserDto.groupIds && createUserDto.groupIds.length > 0) {
      groups = await this.groupRepository.find({
        where: { id: In(createUserDto.groupIds) },
      });

      if (groups.length !== createUserDto.groupIds.length) {
        throw new BadRequestException('One or more group IDs are invalid');
      }
    }

    // Create and save the user
    const user = this.userRepository.create({
      username: createUserDto.username,
      email: createUserDto.email,
      password: createUserDto.password,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      preferences: createUserDto.preferences,
      requiresPasswordChange: createUserDto.requiresPasswordChange || false,
      roles: roles,
    });

    const savedUser = await this.userRepository.save(user);

    // Assign groups using pure many-to-many relationship
    if (groups.length > 0) {
      savedUser.groups = groups;
      await this.userRepository.save(savedUser);
    }

    // Return user with relations
    return this.userRepository.findOne({
      where: { id: savedUser.id },
      relations: ['roles', 'groups'],
    });
  }

  async findAll(search?: string): Promise<Partial<User>[]> {
    const query: FindOptionsWhere<User> = {};

    // Add search filter if provided
    if (search) {
      query.email = Like(`%${search}%`);
    }

    return this.userRepository.find({
      where: query,
      select: [
        'id',
        'email',
        'firstName',
        'lastName',
        'createdAt',
        'updatedAt',
      ],
      relations: ['roles', 'groups'],
    });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'groups'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    console.log(`Looking up user by email: ${email}`);

    try {
      // First, try loading with all relations and explicit select
      try {
        const user = await this.userRepository.findOne({
          where: { email },
          select: {
            // Explicitly select all User base fields needed for auth/subsequent ops
            id: true,
            username: true,
            password: true, // Needed for password comparison
            email: true,
            isActive: true, // Crucial field
            isEmailVerified: true,
            lastLoginAt: true,
            firstName: true,
            lastName: true,
            preferences: true,
            emailVerifiedAt: true,
            registrationVerificationSentAt: true,
            userVerifiedAt: true,
            isDeleted: true,
            deletedAt: true,
            createdAt: true,
            updatedAt: true,
          },
          relations: [
            'roles',
            'roles.rolePermissions',
            'roles.rolePermissions.permission',
            'groups',
            'groups.groupPermissions',
            'groups.groupPermissions.permission',
            'userPermissions',
            'userPermissions.permission',
          ],
        });

        if (user) {
          console.log(`User lookup success for ${email} with ID ${user.id}`);
          console.log(
            `User has ${user.roles?.length || 0} roles, ${user.groups?.length || 0} groups, ${user.userPermissions?.length || 0} direct permissions`,
          );
          return user;
        }
      } catch (relationError) {
        console.error(
          `ERROR: Failed to load user with full relations: ${relationError.message}`,
        );
        console.log('Trying fallback with minimal relations...');
      }

      // Fallback: Try loading with just basic roles if full relations failed
      const basicUser = await this.userRepository.findOne({
        where: { email },
        select: {
          // Explicit select for fallback too
          id: true,
          username: true,
          password: true,
          email: true,
          isActive: true,
          isEmailVerified: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          updatedAt: true,
        },
        relations: ['roles'],
      });

      if (basicUser) {
        console.log(
          `Fallback lookup successful for ${email} with ID ${basicUser.id} (limited permissions)`,
        );
        console.warn(
          `WARNING: User ${email} loaded with limited permission relations. Dynamic access control may not work properly.`,
        );
        return basicUser;
      }

      console.log(`User not found for email: ${email}`);
      return undefined;
    } catch (error) {
      console.error(`Critical error finding user by email ${email}:`, error);
      throw error;
    }
  }

  async findByUsername(username: string): Promise<User | undefined> {
    console.log(`Looking up user by username: ${username}`);

    try {
      const user = await this.userRepository.findOne({
        where: { username },
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
          isEmailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (user) {
        console.log(
          `User lookup success for username ${username} with ID ${user.id}`,
        );
      } else {
        console.log(`User not found for username: ${username}`);
      }

      return user;
    } catch (error) {
      console.error(
        `Critical error finding user by username ${username}:`,
        error,
      );
      throw error;
    }
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    // Validate and hash password if provided
    if (updateUserDto.password) {
      this.passwordValidationService.validate(updateUserDto.password);
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    // Handle roles if provided
    if (updateUserDto.roleIds) {
      const roles = await this.roleRepository.find({
        where: { id: In(updateUserDto.roleIds) },
      });

      if (roles.length !== updateUserDto.roleIds.length) {
        console.error('Role validation failed:', {
          requestedRoleIds: updateUserDto.roleIds,
          foundRoles: roles.map((r) => r.id),
          missingRoleIds: updateUserDto.roleIds.filter(
            (id) => !roles.some((r) => r.id === id),
          ),
        });
        throw new BadRequestException('One or more role IDs are invalid');
      }

      user.roles = roles;
      delete updateUserDto.roleIds; // Remove from DTO to prevent TypeORM issues
    }

    // Handle groups if provided
    if (updateUserDto.groupIds) {
      console.log('Processing group update for user:', {
        userId: id,
        requestedGroupIds: updateUserDto.groupIds,
        currentUserGroups: user.groups?.map((g) => g.id) || [],
      });

      // Validate that all group IDs are valid numbers
      const validGroupIds = updateUserDto.groupIds.filter(
        (id) => typeof id === 'number' && id > 0 && Number.isInteger(id),
      );

      if (validGroupIds.length !== updateUserDto.groupIds.length) {
        console.error('Invalid group IDs detected:', {
          originalIds: updateUserDto.groupIds,
          validIds: validGroupIds,
          invalidIds: updateUserDto.groupIds.filter(
            (id) => !(typeof id === 'number' && id > 0 && Number.isInteger(id)),
          ),
        });
        throw new BadRequestException(
          'One or more group IDs are invalid (not valid numbers)',
        );
      }

      // Remove duplicates
      const uniqueGroupIds = [...new Set(validGroupIds)];

      if (uniqueGroupIds.length !== validGroupIds.length) {
        console.warn('Duplicate group IDs detected and removed:', {
          originalIds: validGroupIds,
          uniqueIds: uniqueGroupIds,
        });
      }

      const groups = await this.groupRepository.find({
        where: { id: In(uniqueGroupIds) },
      });

      if (groups.length !== uniqueGroupIds.length) {
        const foundGroupIds = groups.map((g) => g.id);
        const missingGroupIds = uniqueGroupIds.filter(
          (id) => !foundGroupIds.includes(id),
        );

        console.error('Group validation failed:', {
          requestedGroupIds: uniqueGroupIds,
          foundGroups: foundGroupIds,
          missingGroupIds: missingGroupIds,
          allGroupsInDb: await this.groupRepository.find({
            select: ['id', 'name'],
          }),
        });

        throw new BadRequestException(
          `One or more group IDs are invalid: ${missingGroupIds.join(', ')}`,
        );
      }

      // Update user groups using pure many-to-many relationship
      user.groups = groups;

      console.log('Successfully updated user groups:', {
        userId: id,
        newGroupIds: groups.map((g) => g.id),
        groupNames: groups.map((g) => g.name),
      });

      delete updateUserDto.groupIds; // Remove from DTO to prevent TypeORM issues
    }

    // Update user data (excluding roleIds and groupIds which are now handled above)
    Object.assign(user, updateUserDto);

    // Save the user and reload with fresh relations
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }

  async updateLastLogin(id: number): Promise<void> {
    await this.userRepository.update(id, {
      lastLoginAt: new Date(),
    });
  }

  async setRole(userId: number, roleId: number): Promise<User> {
    const user = await this.findOne(userId);
    const role = await this.roleRepository.findOne({ where: { id: roleId } });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // For now, we'll just add this role to the roles array - we can improve this later
    if (!user.roles) {
      user.roles = [];
    }

    // Check if this role is already in the array
    const existingRoleIndex = user.roles.findIndex(
      (r) => typeof r.id === typeof role.id && String(r.id) === String(role.id),
    );
    if (existingRoleIndex === -1) {
      user.roles.push(role);
    }

    return this.userRepository.save(user);
  }

  async searchUsers(query: string): Promise<Partial<User>[]> {
    return this.userRepository.find({
      where: [
        { email: Like(`%${query}%`) },
        { firstName: Like(`%${query}%`) },
        { lastName: Like(`%${query}%`) },
      ],
      select: ['id', 'email', 'firstName', 'lastName'],
    });
  }

  /**
   * Check if a user has a specific permission
   * @param userId The user ID to check
   * @param resource The resource part of the permission
   * @param action The action part of the permission
   * @returns Promise<boolean> True if the user has the permission
   */
  async checkUserHasPermission(
    userId: number,
    resource: string,
    action: string,
  ): Promise<boolean> {
    return this.permissionsService.checkUserPermission(
      userId,
      resource,
      action,
    );
  }

  /**
   * Check if a user exists by email with a simple query (debug helper)
   */
  async userExistsCheck(email: string): Promise<boolean> {
    console.log(`DEBUG - Simple user existence check for: ${email}`);
    try {
      // Use a direct query without loading relations
      const count = await this.userRepository.count({
        where: { email },
      });

      console.log(
        `DEBUG - User check result for ${email}: ${count > 0 ? 'Exists' : 'Not found'} (Count: ${count})`,
      );
      return count > 0;
    } catch (error) {
      console.error(
        `DEBUG - Error checking user existence: ${error.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Count total users in the database
   */
  async count(): Promise<number> {
    return this.userRepository.count();
  }

  /**
   * Add a user to a role with meaningful response
   */
  async addUserToRole(
    userId: number,
    roleId: number,
  ): Promise<RoleMembershipResult> {
    // Load user and role with relations
    const [user, role] = await Promise.all([
      this.userRepository.findOne({
        where: { id: userId },
        relations: ['roles'],
      }),
      this.roleRepository.findOne({
        where: { id: roleId },
        relations: ['users'],
      }),
    ]);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Check if user already has this role
    const hasRole = user.roles?.some((r) => r.id === role.id);
    if (hasRole) {
      return {
        success: false,
        operation: 'added',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
        },
        timestamp: new Date(),
        message: `User is already a member of role ${role.name}`,
        previousState: {
          wasAlreadyMember: true,
        },
        currentState: {
          isMember: true,
          totalRoleMembers: role.users?.length || 0,
        },
      };
    }

    // Add user to role
    if (!user.roles) {
      user.roles = [];
    }
    user.roles.push(role);

    // Save the user
    await this.userRepository.save(user);

    // Get updated role with fresh member count
    const updatedRole = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: ['users'],
    });

    return {
      success: true,
      operation: 'added',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
      },
      timestamp: new Date(),
      message: `User successfully added to role ${role.name}`,
      previousState: {
        wasAlreadyMember: false,
      },
      currentState: {
        isMember: true,
        memberSince: new Date(),
        totalRoleMembers: updatedRole?.users?.length || 0,
      },
    };
  }

  /**
   * Remove a user from a role with meaningful response
   */
  async removeUserFromRole(
    userId: number,
    roleId: number,
  ): Promise<RoleMembershipResult> {
    // Load user and role with relations
    const [user, role] = await Promise.all([
      this.userRepository.findOne({
        where: { id: userId },
        relations: ['roles'],
      }),
      this.roleRepository.findOne({
        where: { id: roleId },
        relations: ['users'],
      }),
    ]);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Check if user actually has this role
    const hasRole = user.roles?.some((r) => r.id === role.id);
    if (!hasRole) {
      return {
        success: false,
        operation: 'removed',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
        },
        timestamp: new Date(),
        message: `User is not a member of role ${role.name}`,
        previousState: {
          wasAlreadyMember: false,
        },
        currentState: {
          isMember: false,
          totalRoleMembers: role.users?.length || 0,
        },
      };
    }

    // Remove user from role
    user.roles = user.roles.filter((r) => r.id !== role.id);

    // Save the user
    await this.userRepository.save(user);

    // Get updated role with fresh member count
    const updatedRole = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: ['users'],
    });

    return {
      success: true,
      operation: 'removed',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
      },
      timestamp: new Date(),
      message: `User successfully removed from role ${role.name}`,
      previousState: {
        wasAlreadyMember: true,
      },
      currentState: {
        isMember: false,
        totalRoleMembers: updatedRole?.users?.length || 0,
      },
    };
  }

  /**
   * Block a user account
   */
  async blockUser(
    userId: number,
    blockData: {
      reason: string;
      blockedUntil?: Date;
      blockedBy: number;
    },
  ): Promise<void> {
    await this.userRepository.update(userId, {
      isBlocked: true,
      blockedAt: new Date(),
      blockedUntil: blockData.blockedUntil,
      blockedReason: blockData.reason,
    });
  }

  /**
   * Unblock a user account
   */
  async unblockUser(userId: number, unblockedBy: number): Promise<void> {
    await this.userRepository.update(userId, {
      isBlocked: false,
      blockedAt: null,
      blockedUntil: null,
      blockedReason: null,
    });
  }

  /**
   * Get list of blocked users
   */
  async getBlockedUsers(
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ items: User[]; total: number }> {
    const [items, total] = await this.userRepository.findAndCount({
      where: { isBlocked: true },
      order: { blockedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  /**
   * Check if user is currently blocked
   */
  async isUserBlocked(userId: number): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['isBlocked', 'blockedUntil'],
    });

    if (!user || !user.isBlocked) {
      return false;
    }

    // Check if temporary block has expired
    if (user.blockedUntil && new Date() > user.blockedUntil) {
      // Auto-unblock expired temporary blocks
      await this.unblockUser(userId, 0); // System user
      return false;
    }

    return true;
  }

  /**
   * Get all group IDs for a user (including inherited from group hierarchy)
   */
  async getUserGroupIds(userId: number): Promise<number[]> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['groups'],
    });

    if (!user || !user.groups) {
      return [];
    }

    return user.groups.map((g) => g.id);
  }
}
