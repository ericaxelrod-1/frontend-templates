import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PasswordValidationService } from '../auth/password-validation.service';
import * as bcrypt from 'bcrypt';
import { PermissionsService } from '../permissions/services/permissions.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
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

    // If role is not provided, use default role
    if (!createUserDto.role) {
      const defaultRole = await this.roleRepository.findOne({
        where: { isDefault: true },
      });

      if (!defaultRole) {
        throw new BadRequestException('Default role not found');
      }

      createUserDto.role = defaultRole;
    }

    // Create and save the user
    const user = this.userRepository.create(createUserDto);
    return this.userRepository.save(user);
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
      relations: ['roles'],
    });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles'],
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
          select: { // Explicitly select all User base fields needed for auth/subsequent ops
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
        select: { // Explicit select for fallback too
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
        console.log(`User lookup success for username ${username} with ID ${user.id}`);
      } else {
        console.log(`User not found for username: ${username}`);
      }

      return user;
    } catch (error) {
      console.error(`Critical error finding user by username ${username}:`, error);
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

    // Update user data
    Object.assign(user, updateUserDto);

    return this.userRepository.save(user);
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
}
