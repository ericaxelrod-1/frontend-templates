import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, ILike } from 'typeorm';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { User } from '../users/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { ModuleRef } from '@nestjs/core';
import { PermissionsService } from '../permissions/services/permissions.service';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);
  private permissionsService: PermissionsService;

  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    try {
      this.permissionsService = await this.moduleRef.get(PermissionsService, {
        strict: false,
      });
      await this.ensureSystemRoles();
    } catch (error) {
      this.logger.error(`Failed to initialize RolesService: ${error.message}`);
    }
  }

  async create(createRoleDto: CreateRoleDto, currentUser: User): Promise<Role> {
    // Check if user has permission to create roles
    if (!(await this.hasUserPermission(currentUser.id, 'roles', 'create'))) {
      throw new ForbiddenException(
        'You do not have permission to create roles',
      );
    }

    const { permissionIds, ...roleData } = createRoleDto;

    // Validate hierarchy
    if (roleData.parentId) {
      const hierarchyResult = await this.validateRoleHierarchy(0, roleData.parentId);
      if (!hierarchyResult.valid) {
        throw new BadRequestException(hierarchyResult.violations.join('; '));
      }
    }

    // Create role
    const role = this.roleRepository.create(roleData);
    const savedRole = await this.roleRepository.save(role);

    // Assign permissions if provided (with validation)
    if (permissionIds && permissionIds.length > 0) {
      const permResult = await this.validateRolePermissions(savedRole.id, permissionIds);
      if (!permResult.valid) {
        // Rollback role creation if permissions are invalid
        await this.roleRepository.remove(savedRole);
        throw new BadRequestException(permResult.violations.join('; '));
      }
      await this.assignPermissionsToRole(savedRole.id, permissionIds);
    }

    return this.findOne(savedRole.id);
  }

  async findAll(
    page = 0,
    pageSize = 10,
    sortBy = 'name',
    sortDirection: 'ASC' | 'DESC' = 'ASC',
    search = '',
  ): Promise<{ items: Role[]; total: number; page: number; pageSize: number }> {
    const skip = page * pageSize;

    // Build query conditions
    const whereCondition = search ? { name: ILike(`%${search}%`) } : {};

    // Get total count
    const total = await this.roleRepository.count({ where: whereCondition });

    // Get paginated results
    const [items, totalCount] = await this.roleRepository.findAndCount({
      where: whereCondition,
      relations: [
        'parent',
        'children',
        'rolePermissions',
        'rolePermissions.permission',
      ],
      order: { [sortBy]: sortDirection },
      skip,
      take: pageSize,
    });

    return {
      items,
      total: totalCount,
      page,
      pageSize,
    };
  }

  private async findRoleById(id: number): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: [
        'parent',
        'children',
        'rolePermissions',
        'rolePermissions.permission',
      ],
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }
  async findOne(id: number): Promise<Role> {
    return this.transformRoleForFrontend(await this.findRoleById(id));
  }

  async update(
    id: number,
    updateRoleDto: UpdateRoleDto,
    currentUser: User,
  ): Promise<Role> {
    // Check if user has permission to update roles
    if (!(await this.hasUserPermission(currentUser.id, 'roles', 'update'))) {
      throw new ForbiddenException(
        'You do not have permission to update roles',
      );
    }

    const { permissionIds, ...roleData } = updateRoleDto;

    // Check if role exists
    const role = await this.findOne(id);

    // Validate hierarchy if parentId is changing
    if (roleData.parentId !== undefined && roleData.parentId !== role.parentId) {
      const hierarchyResult = await this.validateRoleHierarchy(id, roleData.parentId);
      if (!hierarchyResult.valid) {
        throw new BadRequestException(hierarchyResult.violations.join('; '));
      }
    }

    // Update role properties
    this.roleRepository.merge(role, roleData);
    await this.roleRepository.save(role);

    // Update permissions if provided (with validation)
    if (permissionIds) {
      const permResult = await this.validateRolePermissions(id, permissionIds);
      if (!permResult.valid) {
        throw new BadRequestException(permResult.violations.join('; '));
      }
      await this.rolePermissionRepository.delete({ roleId: id });
      if (permissionIds.length > 0) {
        await this.assignPermissionsToRole(id, permissionIds);
      }
    }

    // Clear permission cache when role is updated
    await this.clearPermissionCaches();

    return this.findOne(id);
  }

  async remove(id: number, currentUser: User): Promise<void> {
    // Check if user has permission to delete roles
    if (!(await this.hasUserPermission(currentUser.id, 'roles', 'delete'))) {
      throw new ForbiddenException(
        'You do not have permission to delete roles',
      );
    }

    const role = await this.findOne(id);

    if (role.isSystemRole) {
      throw new BadRequestException('Cannot delete a system role');
    }

    await this.roleRepository.remove(role);

    // Clear permission cache when role is deleted
    await this.clearPermissionCaches();
  }

  async assignPermissionsToRole(
    roleId: number,
    permissionIds: number[],
  ): Promise<void> {
    // Verify all permissions exist
    const permissions = await this.permissionRepository.find({
      where: { id: In(permissionIds) },
    });

    if (permissions.length !== permissionIds.length) {
      throw new NotFoundException('One or more permissions not found');
    }

    // Create role-permission relationships
    const rolePermissions = permissionIds.map((permissionId) =>
      this.rolePermissionRepository.create({
        roleId,
        permissionId,
      }),
    );

    await this.rolePermissionRepository.save(rolePermissions);

    // Clear permission cache when permissions are assigned
    await this.clearPermissionCaches();
  }

  async getRolePermissions(roleId: number): Promise<Permission[]> {
    const role = await this.findRoleById(roleId);
    return role.rolePermissions.map((rp) => rp.permission);
  }

  // Utility method to get all permissions for a user's roles
  async getUserPermissions(userRoleIds: number[]): Promise<string[]> {
    const cacheKey = `user_permission:${userRoleIds.sort().join(',')}`;

    // Try to get permissions from cache
    const cachedPermissions = await this.cacheManager.get<string[]>(cacheKey);
    if (cachedPermissions) {
      return cachedPermissions;
    }

    // If not in cache, fetch from database
    const rolePermissions = await this.rolePermissionRepository.find({
      where: { roleId: In(userRoleIds) },
      relations: ['permission'],
    });

    // Format permissions as 'resource:action' strings following the dynamic-access-control rule
    const permissions = rolePermissions.map((rp) => rp.permission.name);

    // Remove duplicates
    const uniquePermissions = [...new Set(permissions)];

    // Cache the permissions
    await this.cacheManager.set(cacheKey, uniquePermissions, 3600); // Cache for 1 hour

    return uniquePermissions;
  }

  // Utility method to check if a user has a specific permission
  async hasPermission(
    userRoleIds: number[],
    permissionName: string,
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(userRoleIds);
    return permissions.includes(permissionName);
  }

  // Utility method to check if a user has any of the given permissions
  async hasAnyPermission(
    userRoleIds: number[],
    permissionNames: string[],
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(userRoleIds);
    return permissionNames.some((permission) =>
      permissions.includes(permission),
    );
  }

  // Utility method to check if a user has all of the given permissions
  async hasAllPermissions(
    userRoleIds: number[],
    permissionNames: string[],
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(userRoleIds);
    return permissionNames.every((permission) =>
      permissions.includes(permission),
    );
  }

  async getAncestors(roleId: number): Promise<Role[]> {
    const ancestors: Role[] = [];
    let currentRole = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: ['parent'],
    });

    while (currentRole?.parent) {
      ancestors.push(currentRole.parent);
      currentRole = await this.roleRepository.findOne({
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
      const children = await this.roleRepository.find({
        where: { parentId: currentId },
      });

      for (const child of children) {
        descendants.push(child);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  async validateNoCircularReference(
    roleId: number,
    newParentId: number,
  ): Promise<boolean> {
    if (roleId === newParentId) {
      throw new Error('A role cannot be its own parent');
    }

    let currentId: number | null = newParentId;
    const visited = new Set<number>([roleId]);

    while (currentId !== null) {
      if (visited.has(currentId)) {
        throw new Error(
          'Setting this parent would create a circular reference',
        );
      }

      visited.add(currentId);
      const parent = await this.roleRepository.findOne({
        where: { id: currentId },
        relations: ['parent'],
      });

      currentId = parent?.parent?.id ?? null;
    }

    return true;
  }

  async getEffectivePermissions(
    roleId: number,
  ): Promise<{ permission: string; isGranted: boolean; source: string }[]> {
    const role = await this.findOne(roleId);
    const hierarchyPath = [
      role,
      ...(await this.getAncestors(roleId)).reverse(),
    ];

    const permissionMap = new Map<
      string,
      { isGranted: boolean; source: string }
    >();

    for (const r of hierarchyPath) {
      if (!r.rolePermissions) continue;

      for (const rp of r.rolePermissions) {
        const permName = rp.permission?.name;
        if (!permName) continue;

        if (!permissionMap.has(permName)) {
          permissionMap.set(permName, {
            isGranted: rp.isGranted,
            source: r.name,
          });
        } else {
          const existing = permissionMap.get(permName)!;
          if (rp.isGranted !== null && rp.isGranted !== undefined) {
            if (
              existing.isGranted === null ||
              existing.isGranted === undefined
            ) {
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

  async validatePermissionConstraints(
    childRoleId: number,
    newPermissions: { permissionId: number; isGranted: boolean }[],
  ): Promise<{ valid: boolean; violations: string[] }> {
    const childRole = await this.findOne(childRoleId);
    const violations: string[] = [];

    if (!childRole.parentId) {
      return { valid: true, violations: [] };
    }

    const parentPermissions = await this.getEffectivePermissions(
      childRole.parentId,
    );
    const parentPermMap = new Map(
      parentPermissions.map((p) => [p.permission, p.isGranted]),
    );

    for (const newPerm of newPermissions) {
      const permission = await this.permissionRepository.findOne({
        where: { id: newPerm.permissionId },
      });

      if (!permission) continue;

      const parentValue = parentPermMap.get(permission.name);

      if (parentValue === false && newPerm.isGranted === true) {
        violations.push(
          `Permission "${permission.name}" is denied in parent but would be granted in child`,
        );
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  // Clear all permission-related caches
  private async clearPermissionCaches(): Promise<void> {
    // Reset the entire cache store. The RolesModule uses an isolated
    // CacheModule.register() instance, so this only affects permission caches.
    await (this.cacheManager as any).clear();
  }

  /**
   * Update role permissions
   */
  async updateRolePermissions(
    id: number,
    permissions: string[],
    currentUser: User,
  ): Promise<Role> {
    // Check if user has permission to update role permissions
    if (!(await this.hasUserPermission(currentUser.id, 'roles', 'update'))) {
      throw new ForbiddenException(
        'You do not have permission to update role permissions',
      );
    }

    const role = await this.findOne(id);

    // Parse permission strings to get permission entities
    const permissionEntities =
      await this.parsePermissionStringsForRoles(permissions);

    // Clear existing permissions
    await this.rolePermissionRepository.delete({ roleId: id });

    // Assign new permissions
    if (permissionEntities.length > 0) {
      const rolePermissions = permissionEntities.map((permissionId) =>
        this.rolePermissionRepository.create({
          roleId: id,
          permissionId,
          isGranted: true,
        }),
      );
      await this.rolePermissionRepository.save(rolePermissions);
    }

    // Clear permission cache
    await this.clearPermissionCaches();

    return this.findOne(id);
  }

  /**
   * Assign role to user
   */
  async assignRoleToUser(
    userId: number,
    roleId: number,
    currentUser: User,
  ): Promise<User> {
    // Check if user has permission to assign roles
    if (!(await this.hasUserPermission(currentUser.id, 'users', 'update'))) {
      throw new ForbiddenException(
        'You do not have permission to assign roles to users',
      );
    }

    // Check if user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Check if role exists
    const role = await this.findOne(roleId);

    // Check if user already has this role
    const hasRole = user.roles?.some((r) => r.id === roleId);
    if (hasRole) {
      throw new BadRequestException('User already has this role');
    }

    // Add role to user
    if (!user.roles) {
      user.roles = [];
    }
    user.roles.push(role);

    await this.userRepository.save(user);

    // Clear user permissions cache
    await this.clearPermissionCaches();

    return user;
  }

  /**
   * Check if user has a specific permission
   */
  private async hasUserPermission(
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
      // If permissions service is not available or user has no permissions, return false
      return false;
    }
  }

  /**
   * Parse permission strings and return permission IDs
   */
  private async parsePermissionStringsForRoles(
    permissionStrings: string[],
  ): Promise<number[]> {
    const permissionIds: number[] = [];

    for (const permissionString of permissionStrings) {
      const [resourceName, actionName] = permissionString.split(':');

      if (!resourceName || !actionName) {
        continue;
      }

      // Find the action
      let action = await this.permissionRepository.manager.query(
        'SELECT a.id FROM actions a WHERE a.name = ?',
        [actionName],
      );

      if (action.length === 0) {
        // Create action if not found
        const [newAction] = await this.permissionRepository.manager.query(
          'INSERT INTO actions (name, action_code, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
          [
            actionName,
            actionName,
            `${actionName} action`,
            new Date(),
            new Date(),
          ],
        );
        action = [newAction];
      }

      // Find the permission
      const [permission] = await this.permissionRepository.manager.query(
        'SELECT p.id FROM permissions p WHERE p.resource_name = ? AND p.action_id = ?',
        [resourceName, action[0].id],
      );

      if (permission) {
        permissionIds.push(permission.id);
      }
    }

    return permissionIds;
  }

  /**
   * Ensure system roles exist
   */
  private async ensureSystemRoles(): Promise<void> {
    try {
      const systemRoles = [
        {
          name: 'user',
          description: 'Default user role with basic permissions',
          isSystemRole: true,
        },
        {
          name: 'superuser',
          description: 'Superuser role with advanced permissions',
          isSystemRole: true,
        },
        {
          name: 'Administrator',
          description: 'Administrator role with elevated permissions',
          isSystemRole: true,
        },
        {
          name: 'Super Administrator',
          description: 'Super Administrator role with all permissions',
          isSystemRole: true,
        },
      ];

      for (const roleData of systemRoles) {
        const existingRole = await this.roleRepository.findOne({
          where: { name: roleData.name, isSystemRole: true },
        });

        if (!existingRole) {
          const role = this.roleRepository.create(roleData);
          await this.roleRepository.save(role);
          this.logger.log(`Created system role: ${roleData.name}`);
        }
      }

      await this.assignDefaultPermissions();
    } catch (error) {
      this.logger.error(
        `Failed to ensure system roles: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Assign default permissions to system roles
   */
  private async assignDefaultPermissions(): Promise<void> {
    try {
      const permissionsService = await this.getPermissionsService();

      const rolePermissionMapping = {
        user: ['users:read', 'dashboard:read', 'groups:read'],
        superuser: [
          'users:read',
          'users:create',
          'users:update',
          'roles:read',
          'dashboard:read',
          'groups:read',
          'groups:create',
          'groups:update',
          'permissions:read',
        ],
        Administrator: [
          'users:read',
          'users:create',
          'users:update',
          'users:delete',
          'roles:read',
          'roles:create',
          'roles:update',
          'dashboard:read',
          'groups:read',
          'groups:create',
          'groups:update',
          'groups:delete',
          'permissions:read',
          'permissions:update',
        ],
        'Super Administrator': [
          'users:read',
          'users:create',
          'users:update',
          'users:delete',
          'roles:read',
          'roles:create',
          'roles:update',
          'roles:delete',
          'dashboard:read',
          'groups:read',
          'groups:create',
          'groups:update',
          'groups:delete',
          'permissions:read',
          'permissions:update',
          'permissions:delete',
          'rls:admin',
        ],
      };

      for (const [roleName, permissionStrings] of Object.entries(
        rolePermissionMapping,
      )) {
        const role = await this.roleRepository.findOne({
          where: { name: roleName, isSystemRole: true },
        });

        if (role) {
          // Ensure all permissions exist
          for (const permissionString of permissionStrings) {
            const [resourceName, actionName] = permissionString.split(':');
            await permissionsService.ensurePermissionExists(
              resourceName,
              actionName,
            );
          }

          // Assign permissions to role
          await permissionsService.assignPermissionsToRole(
            role.id,
            permissionStrings,
          );
          this.logger.log(`Assigned default permissions to role: ${roleName}`);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to assign default permissions: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get permissions service instance
   */
  private async getPermissionsService(): Promise<PermissionsService> {
    if (!this.permissionsService) {
      this.permissionsService = await this.moduleRef.get(PermissionsService, {
        strict: false,
      });
    }
    return this.permissionsService;
  }

  /**
   * Transform role for frontend consumption
   */
  private transformRoleForFrontend(role: Role): Role {
    // Create a new role object with sanitized data for frontend
    const transformed = {
      ...role,
      rolePermissions: role.rolePermissions?.map((rp) => ({
        roleId: rp.roleId,
        permissionId: rp.permissionId,
        isGranted: rp.isGranted,
        permission: {
          id: rp.permission.id,
          name: rp.permission.name,
          resourceName: rp.permission.resourceName,
          description: rp.permission.description,
        },
      })),
    };
    return transformed as Role;
  }

  /**
   * Find role by name
   */
  async findByName(name: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { name } });
    if (!role) throw new NotFoundException(`Role ${name} not found`);
    return role;
  }

  /**
   * Validate parent role removal
   */
  async validateParentRemoval(roleId: number): Promise<{
    valid: boolean;
    affectedChildren: { id: number; name: string }[];
  }> {
    const children = await this.roleRepository.find({
      where: { parentId: roleId },
    });
    const affectedChildren = children.map((c) => ({ id: c.id, name: c.name }));
    return { valid: true, affectedChildren };
  }

  /**
   * Validate role hierarchy constraints
   */
  async validateRoleHierarchy(
    roleId: number,
    newParentId: number | null,
  ): Promise<{ valid: boolean; violations: string[] }> {
    const violations: string[] = [];

    // Check for circular reference
    if (newParentId === roleId) {
      violations.push('A role cannot be its own parent');
    }

    if (newParentId !== null) {
      try {
        await this.validateNoCircularReference(roleId, newParentId);
      } catch (error) {
        violations.push(error.message);
      }
    }

    // Check if role has system-defined children
    const children = await this.roleRepository.find({
      where: { parentId: roleId },
    });
    const systemChildren = children.filter((c) => c.isSystemRole);
    if (systemChildren.length > 0 && newParentId !== null) {
      violations.push(
        'Cannot change parent of a role that has system-defined children',
      );
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Validate role permissions against parent constraints
   */
  async validateRolePermissions(
    roleId: number,
    permissionIds: number[],
  ): Promise<{ valid: boolean; violations: string[] }> {
    const role = await this.findOne(roleId);
    const violations: string[] = [];

    if (!role.parentId) {
      return { valid: true, violations: [] };
    }

    // Check if all permissions exist
    const permissions = await this.permissionRepository.find({
      where: { id: In(permissionIds) },
    });

    if (permissions.length !== permissionIds.length) {
      violations.push('One or more permissions not found');
    }

    // Validate against parent constraints
    const constraintResult = await this.validatePermissionConstraints(
      roleId,
      permissions.map((p) => ({
        permissionId: p.id,
        isGranted: true,
      })),
    );

    violations.push(...constraintResult.violations);

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}
