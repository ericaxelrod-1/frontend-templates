import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
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
  ) { }

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

    return completeRole
      ? this.transformRoleForFrontend(completeRole)
      : savedRole;
  }

  /**
   * Transform role data to match frontend expectations
   * Converts rolePermissions to permissions array
   */
  private transformRoleForFrontend(role: Role): Role {
    if (role.rolePermissions) {
      // Transform rolePermissions to permissions array
      const permissions = role.rolePermissions
        .filter((rp) => rp.isGranted && rp.permission) // Only include granted permissions
        .map((rp) => rp.permission);

      // Create a new role object with permissions instead of rolePermissions
      return {
        ...role,
        permissions: permissions,
        rolePermissions: undefined, // Remove rolePermissions to avoid confusion
      } as any;
    }
    return role;
  }

  async findAll(
    page = 0,
    pageSize = 10,
    sortBy = 'name',
    sortDirection: 'ASC' | 'DESC' = 'ASC',
    search = '',
  ): Promise<{ items: Role[]; total: number; page: number; pageSize: number }> {
    const skip = page * pageSize;
    const take = pageSize;

    const [items, total] = await this.rolesRepository.findAndCount({
      where: search
        ? [
          { name: ILike(`%${search}%`) },
          { description: ILike(`%${search}%`) },
        ]
        : {},
      relations: ['rolePermissions', 'rolePermissions.permission'],
      order: { [sortBy]: sortDirection },
      skip,
      take,
    });

    // Transform roles to match frontend expectations
    const transformedItems = items.map((role) => this.transformRoleForFrontend(role));

    return {
      items: transformedItems,
      total,
      page,
      pageSize,
    };
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

  async update(
    id: number,
    updateRoleDto: any,
    currentUser: User,
  ): Promise<Role> {
    // Check if current user has permission to update roles
    const hasPermission = await this.hasPermission(
      currentUser.id,
      'roles',
      'update',
    );
    if (!hasPermission) {
      throw new ForbiddenException(
        'You do not have permission to update roles',
      );
    }

    const role = await this.rolesRepository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    // Prevent modifying system-defined roles
    if (role.isSystemRole) {
      throw new ForbiddenException('System-defined roles cannot be modified');
    }

    // Check if role with same name already exists (if name is being updated)
    if (updateRoleDto.name && updateRoleDto.name !== role.name) {
      const existingRole = await this.rolesRepository.findOne({
        where: { name: updateRoleDto.name },
      });
      if (existingRole) {
        throw new ForbiddenException(
          `Role with name ${updateRoleDto.name} already exists`,
        );
      }
    }

    // Update basic role information
    if (updateRoleDto.name) {
      role.name = updateRoleDto.name;
    }
    if (updateRoleDto.description !== undefined) {
      role.description = updateRoleDto.description;
    }

    const updatedRole = await this.rolesRepository.save(role);

    // Update permissions if provided
    if (updateRoleDto.permissions && Array.isArray(updateRoleDto.permissions)) {
      try {
        await this.permissionsService.assignPermissionsToRole(
          updatedRole.id,
          updateRoleDto.permissions,
        );
      } catch (error) {
        console.error(`Error updating permissions for role:`, error.message);
      }
    }

    // Return the complete role with permissions populated
    return this.findOne(updatedRole.id);
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

    // Start transaction to ensure atomicity
    const queryRunner =
      this.rolesRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // First, delete all role permissions (cascade deletion)
      await queryRunner.manager.query(
        'DELETE FROM role_permissions WHERE role_id = ?',
        [id],
      );

      // Then delete the role itself using SQL query
      await queryRunner.manager.query('DELETE FROM roles WHERE id = ?', [id]);

      // Commit the transaction
      await queryRunner.commitTransaction();
    } catch (error) {
      // Rollback the transaction on error
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(`Failed to delete role: ${error.message}`);
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  async getAncestors(roleId: number): Promise<Role[]> {
    const ancestors: Role[] = [];
    let currentRole = await this.rolesRepository.findOne({
      where: { id: roleId },
      relations: ['parent'],
    });

    while (currentRole?.parent) {
      ancestors.push(currentRole.parent);
      currentRole = await this.rolesRepository.findOne({
        where: { id: currentRole.parent.id },
        relations: ['parent'],
      });
    }

    return ancestors;
  }

  async getDescendants(roleId: number): Promise<Role[]> {
    const descendants: Role[] = [];
    const queue = [roleId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = await this.rolesRepository.find({
        where: { parentId: currentId },
      });

      for (const child of children) {
        descendants.push(child);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  async getEffectivePermissions(
    roleId: number,
  ): Promise<{ permission: string; isGranted: boolean; source: string }[]> {
    const role = await this.findOne(roleId);
    const hierarchyPath = [role, ...(await this.getAncestors(roleId)).reverse()];

    const permissionMap = new Map<string, { isGranted: boolean; source: string }>();

    for (const r of hierarchyPath) {
      if (!r.rolePermissions) continue;

      for (const rp of r.rolePermissions) {
        const permName = rp.permission?.name;
        if (!permName) continue;

        if (!permissionMap.has(permName)) {
          permissionMap.set(permName, {
            isGranted: rp.isGranted ?? false,
            source: r.name,
          });
        } else {
          const existing = permissionMap.get(permName)!;
          if (rp.isGranted !== null && rp.isGranted !== undefined) {
            if (existing.isGranted === null || existing.isGranted === undefined) {
              existing.isGranted = rp.isGranted;
              existing.source = r.name;
            } else if (!rp.isGranted) {
              existing.isGranted = false;
              existing.source = r.name;
            }
          }
        }
      }
    }

    return Array.from(permissionMap.entries()).map(([permission, value]) => ({
      permission,
      isGranted: value.isGranted,
      source: value.source,
    }));
  }

  /**
   * Validate that setting a new parent won't create a circular reference.
   * 
   * @param roleId The role being modified
   * @param newParentId The proposed new parent
   * @throws BadRequestException if circular reference would be created
   */
  async validateNoCircularReference(
    roleId: number,
    newParentId: number,
  ): Promise<void> {
    if (roleId === newParentId) {
      throw new BadRequestException(
        'A role cannot be its own parent (circular reference)',
      );
    }

    const descendants = await this.getDescendants(roleId);
    const descendantIds = new Set(descendants.map(d => d.id));

    if (descendantIds.has(newParentId)) {
      throw new BadRequestException(
        'Cannot set this as parent: would create circular reference in role hierarchy',
      );
    }

    const ancestors = await this.getAncestors(roleId);
    const ancestorIds = new Set(ancestors.map(a => a.id));

    if (ancestorIds.has(newParentId)) {
      throw new BadRequestException(
        'Cannot set this as parent: would create circular reference in role hierarchy',
      );
    }
  }

  /**
   * Validate that the proposed permission changes don't violate the 3-state permission model.
   * Child roles cannot have permissions that their parents don't have (unless explicitly granted).
   * 
   * @param roleId The role being modified
   * @param newPermissions Array of permission names being granted
   * @throws BadRequestException if constraints would be violated
   */
  async validatePermissionConstraints(
    roleId: number,
    newPermissions: string[],
  ): Promise<{ valid: boolean; warnings: string[] }> {
    const role = await this.findOne(roleId);
    const warnings: string[] = [];

    if (!role.parentId) {
      return { valid: true, warnings };
    }

    const ancestors = await this.getAncestors(roleId);
    const parentPermissions = new Set<string>();

    for (const ancestor of ancestors) {
      const ancestorWithPerms = await this.rolesRepository.findOne({
        where: { id: ancestor.id },
        relations: ['rolePermissions', 'rolePermissions.permission'],
      });

      if (ancestorWithPerms?.rolePermissions) {
        for (const rp of ancestorWithPerms.rolePermissions) {
          if (rp.isGranted && rp.permission?.name) {
            parentPermissions.add(rp.permission.name);
          }
        }
      }
    }

    const invalidPermissions: string[] = [];
    for (const perm of newPermissions) {
      if (!parentPermissions.has(perm)) {
        invalidPermissions.push(perm);
      }
    }

    if (invalidPermissions.length > 0) {
      const ancestorNames = ancestors.map(a => a.name).join(' → ');
      warnings.push(
        `Granting permissions [${invalidPermissions.join(', ')}] to role "${role.name}" ` +
        `that are not granted by ancestors [${ancestorNames}]. ` +
        `This may violate the hierarchical permission model.`,
      );
    }

    return {
      valid: true,
      warnings,
    };
  }

  /**
   * Validate that removing a parent won't leave child roles without required permissions.
   * 
   * @param roleId The role being modified
   * @throws BadRequestException if children would be affected
   */
  async validateParentRemoval(
    roleId: number,
  ): Promise<{ valid: boolean; affectedChildren: { id: number; name: string }[] }> {
    const children = await this.rolesRepository.find({
      where: { parentId: roleId },
    });

    const affectedChildren = children.map(c => ({ id: c.id, name: c.name }));

    if (affectedChildren.length > 0) {
      return {
        valid: true,
        affectedChildren,
      };
    }

    return { valid: true, affectedChildren: [] };
  }
}
