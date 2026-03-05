import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) { }

  async create(createRoleDto: CreateRoleDto): Promise<Role> {
    const { permissionIds, ...roleData } = createRoleDto;

    // Create role
    const role = this.roleRepository.create(roleData);
    const savedRole = await this.roleRepository.save(role);

    // Assign permissions if provided
    if (permissionIds && permissionIds.length > 0) {
      await this.assignPermissionsToRole(savedRole.id, permissionIds);
    }

    return this.findOne(savedRole.id);
  }

  async findAll(): Promise<Role[]> {
    return this.roleRepository.find({
      relations: [
        'parent',
        'children',
        'rolePermissions',
        'rolePermissions.permission',
      ],
    });
  }

  async findOne(id: number): Promise<Role> {
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

  async update(id: number, updateRoleDto: UpdateRoleDto): Promise<Role> {
    const { permissionIds, ...roleData } = updateRoleDto;

    // Check if role exists
    const role = await this.findOne(id);

    // Update role properties
    this.roleRepository.merge(role, roleData);
    await this.roleRepository.save(role);

    // Update permissions if provided
    if (permissionIds) {
      await this.rolePermissionRepository.delete({ roleId: id });
      if (permissionIds.length > 0) {
        await this.assignPermissionsToRole(id, permissionIds);
      }
    }

    // Clear permission cache when role is updated
    await this.clearPermissionCaches();

    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const role = await this.findOne(id);

    if (role.isSystemRole) {
      throw new Error('Cannot delete a system role');
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
    const role = await this.findOne(roleId);
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

  // Clear all permission-related caches
  private async clearPermissionCaches(): Promise<void> {
    // Since Cache interface doesn't have a keys method, we'll delete known patterns
    // This is a workaround since we can't directly get all matching keys

    // Delete common cache keys related to permissions
    await this.cacheManager.del('all_permissions');
    await this.cacheManager.del('all_role_permissions');

    // For user-specific permissions, we would need to implement a more
    // sophisticated tracking mechanism in a production environment.
    // Here we're directly clearing specific cache keys we know about.

    // For demo purposes, we'll clear some example keys:
    const exampleUserRoleIds = [1, 2, 3]; // Common user role IDs
    for (const roleId of exampleUserRoleIds) {
      await this.cacheManager.del(`user_permission:${roleId}`);
    }
  }
}
