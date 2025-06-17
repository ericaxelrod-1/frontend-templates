import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';
import { PermissionsService } from '../permissions/services/permissions.service';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private rolesRepository: Repository<Role>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private permissionsService: PermissionsService,
  ) {}

  // Helper method to simplify permission checks
  private async hasPermission(
    userId: number,
    resource: string,
    action: string,
  ): Promise<boolean> {
    try {
      return await this.permissionsService.checkUserPermission(
        userId,
        resource,
        action,
      );
    } catch (error) {
      console.error(`Error checking permission: ${error.message}`);
      return false;
    }
  }

  async onModuleInit() {
    // Ensure system roles exist on application startup
    await this.ensureSystemRoles();
  }

  async ensureSystemRoles() {
    // Define standard system roles using preferred (numerically lowest ID) role names
    // Only the 4 roles we want to keep in the database
    const standardRoles = [
      {
        name: 'user',
        description: 'Regular user with basic permissions',
        isDefault: true,
      },
      {
        name: 'superuser',
        description: 'Super user with advanced permissions',
        isDefault: false,
      },
      {
        name: 'Administrator',
        description: 'Administrator with elevated permissions',
        isDefault: false,
      },
      {
        name: 'Super Administrator',
        description: 'Super administrator with all permissions',
        isDefault: false,
      },
    ];

    // Check for each system role and create if missing
    for (const roleInfo of standardRoles) {
      const existingRole = await this.rolesRepository.findOne({
        where: { name: roleInfo.name },
      });

      if (!existingRole) {
        // Create the role
        const newRole = this.rolesRepository.create({
          name: roleInfo.name,
          isSystemRole: true,
          description: roleInfo.description,
          isDefault: roleInfo.isDefault,
        });

        const savedRole = await this.rolesRepository.save(newRole);

        // Assign default permissions to the role
        await this.assignDefaultPermissions(savedRole.id, roleInfo.name);
      }
    }
  }

  private async assignDefaultPermissions(roleId: number, roleName: string) {
    // Define permission mappings for standard roles
    const permissionMappings = {
      user: ['self:profile:read', 'self:profile:update'],
      Administrator: [
        'users:create',
        'users:view',
        'users:update',
        'users:delete',
        'groups:create',
        'groups:view',
        'groups:update',
        'groups:delete',
        'groups:manage',
      ],
      superuser: [
        'users:create',
        'users:view',
        'users:update',
        'users:delete',
        'users:manage',
        'groups:create',
        'groups:view',
        'groups:update',
        'groups:delete',
        'groups:manage',
        'roles:view',
        'roles:create',
      ],
      'Super Administrator': [
        'users:create',
        'users:view',
        'users:update',
        'users:delete',
        'users:admin',
        'users:manage',
        'users:emulate',
        'groups:create',
        'groups:view',
        'groups:update',
        'groups:delete',
        'groups:admin',
        'groups:manage',
        'roles:create',
        'roles:view',
        'roles:update',
        'roles:delete',
        'roles:admin',
        'roles:manage',
        'roles:assign',
        'permissions:view',
        'permissions:update',
        'permissions:admin',
        'permissions:refresh',
        'system:admin',
      ],
    };

    // Get permissions for this role
    const permissionStrings = permissionMappings[roleName] || [];

    // Create permissions in database if they don't exist and assign to role
    for (const permString of permissionStrings) {
      const [resourceName, actionName] = permString.split(':');

      // Ensure permission exists
      await this.permissionsService.ensurePermissionExists(
        resourceName,
        actionName,
      );
    }

    // Assign permissions to role
    try {
      await this.permissionsService.assignPermissionsToRole(
        roleId,
        permissionStrings,
      );
    } catch (error) {
      console.error(
        `Error assigning permissions to role ${roleName}:`,
        error.message,
      );
    }
  }

  async create(createRoleDto: any, currentUser: User): Promise<Role> {
    // Check if current user has permission to create roles
    const hasPermission = await this.hasPermission(
      currentUser.id,
      'roles',
      'create',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to create roles',
      );
    }

    // Check if role with same name already exists
    const existingRole = await this.rolesRepository.findOne({
      where: { name: createRoleDto.name },
    });
    if (existingRole) {
      throw new ForbiddenException(
        `Role with name ${createRoleDto.name} already exists`,
      );
    }

    const role = this.rolesRepository.create({
      name: createRoleDto.name,
      description:
        createRoleDto.description || `Custom role: ${createRoleDto.name}`,
      isSystemRole: false,
    });

    const savedRole = await this.rolesRepository.save(role);

    // Assign permissions if provided
    if (createRoleDto.permissions && Array.isArray(createRoleDto.permissions)) {
      try {
        await this.permissionsService.assignPermissionsToRole(
          savedRole.id,
          createRoleDto.permissions,
        );
      } catch (error) {
        console.error(
          `Error assigning permissions to new role:`,
          error.message,
        );
      }
    }

    // Return the complete role with permissions populated
    const completeRole = await this.rolesRepository.findOne({
      where: { id: savedRole.id },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });

    return completeRole ? this.transformRoleForFrontend(completeRole) : savedRole;
  }

  /**
   * Transform role data to match frontend expectations
   * Converts rolePermissions to permissions array
   */
  private transformRoleForFrontend(role: Role): Role {
    if (role.rolePermissions) {
      // Transform rolePermissions to permissions array
      const permissions = role.rolePermissions
        .filter(rp => rp.isGranted && rp.permission) // Only include granted permissions
        .map(rp => rp.permission);
      
      // Create a new role object with permissions instead of rolePermissions
      return {
        ...role,
        permissions: permissions,
        rolePermissions: undefined, // Remove rolePermissions to avoid confusion
      } as any;
    }
    return role;
  }

  async findAll(): Promise<Role[]> {
    const roles = await this.rolesRepository.find({
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
    
    // Transform roles to match frontend expectations
    return roles.map(role => this.transformRoleForFrontend(role));
  }

  async findOne(id: number): Promise<Role> {
    const role = await this.rolesRepository.findOne({ 
      where: { id },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    return this.transformRoleForFrontend(role);
  }

  async findByName(name: string): Promise<Role> {
    const role = await this.rolesRepository.findOne({ where: { name } });
    if (!role) {
      throw new NotFoundException(`Role ${name} not found`);
    }
    return role;
  }

  async assignRoleToUser(
    userId: number,
    roleId: number,
    currentUser: User,
  ): Promise<User> {
    // Check if current user has permission to manage roles
    const hasPermission = await this.hasPermission(
      currentUser.id,
      'roles',
      'manage',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to manage roles',
      );
    }

    const [user, role] = await Promise.all([
      this.usersRepository.findOne({
        where: { id: userId },
        relations: ['roles'],
      }),
      this.rolesRepository.findOne({ where: { id: roleId } }),
    ]);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Prevent changing system admin permissions unless current user has system admin permission
    const userHasSystemAdmin = await this.hasPermission(
      user.id,
      'system',
      'admin',
    );
    const currentUserHasSystemAdmin = await this.hasPermission(
      currentUser.id,
      'system',
      'admin',
    );

    if (userHasSystemAdmin && !currentUserHasSystemAdmin) {
      throw new ForbiddenException(
        'Only system administrators can modify system administrator roles',
      );
    }

    // Add the role to the user's roles array if it's not already there
    if (!user.roles) {
      user.roles = [];
    }

    if (!user.roles.some((r) => r.id === role.id)) {
      user.roles.push(role);
    }

    return this.usersRepository.save(user);
  }

  async updateRolePermissions(
    id: number,
    permissions: string[],
    currentUser: User,
  ): Promise<Role> {
    // Only users with roles:admin permission can update role permissions
    const hasPermission = await this.hasPermission(
      currentUser.id,
      'roles',
      'admin',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to update role permissions',
      );
    }

    const role = await this.findOne(id);

    // Prevent modifying system-defined roles
    if (role.isSystemRole) {
      throw new ForbiddenException('System-defined roles cannot be modified');
    }

    try {
      await this.permissionsService.assignPermissionsToRole(id, permissions);
    } catch (error) {
      console.error(`Error updating role permissions:`, error.message);
      throw new BadRequestException(
        `Failed to update role permissions: ${error.message}`,
      );
    }

    return role;
  }

  async remove(id: number, currentUser: User): Promise<void> {
    // Only users with roles:admin permission can delete roles
    const hasPermission = await this.hasPermission(
      currentUser.id,
      'roles',
      'admin',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to delete roles',
      );
    }

    const role = await this.findOne(id);

    // Prevent deleting system-defined roles
    if (role.isSystemRole) {
      throw new ForbiddenException('System-defined roles cannot be deleted');
    }

    // Check if there are users with this role
    const usersWithRole = await this.usersRepository.find({
      where: { roles: { id: role.id } },
      take: 1,
    });

    if (usersWithRole.length > 0) {
      throw new ForbiddenException(
        'Cannot delete role that is assigned to users',
      );
    }

    await this.rolesRepository.remove(role);
  }
}
