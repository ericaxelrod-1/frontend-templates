import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { IPermissionChecker } from '../shared/interfaces/permission-checker.interface';
import { PermissionsService } from './permissions.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserPermission } from '../entities/user-permission.entity';
import { GroupPermission } from '../entities/group-permission.entity';

/**
 * Implementation of the permission checker interface
 * This is used to check permissions without circular dependencies
 */
@Injectable()
export class PermissionCheckerService implements IPermissionChecker {
  constructor(
    @Inject(forwardRef(() => PermissionsService))
    private readonly permissionsService: PermissionsService,
    
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    
    @InjectRepository(UserPermission)
    private readonly userPermissionRepository: Repository<UserPermission>,
    
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepository: Repository<GroupPermission>,
  ) {}

  /**
   * Check if a user has a specific permission
   * @param userId - The ID of the user to check
   * @param resourceName - The resource to check permissions for
   * @param actionName - The action to check permissions for
   * @returns True if the user has permission, false otherwise
   */
  async checkUserPermission(
    userId: number,
    resourceName: string,
    actionName: string,
  ): Promise<boolean> {
    try {
      // Try to use the permissions service first, which might have caching
      return this.permissionsService.checkUserPermission(
        userId,
        resourceName,
        actionName,
      );
    } catch (error) {
      // Fallback implementation to avoid circular dependency issues
      const permissions = await this.getUserPermissions(userId);
      return permissions.includes(`${resourceName}:${actionName}`);
    }
  }

  /**
   * Get all permissions for a user
   * @param userId - The ID of the user
   * @returns An array of permission strings in the format "resource:action"
   */
  async getUserPermissions(userId: number): Promise<string[]> {
    try {
      // Try to use the permissions service first, which might have caching
      return this.permissionsService.getUserPermissions(userId);
    } catch (error) {
      // Fallback implementation to avoid circular dependency issues
      const user = await this.userRepository.findOne({
        where: { id: userId },
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

      if (!user) {
        return [];
      }

      const permissions: string[] = [];

      // Add role permissions
      for (const role of user.roles || []) {
        if (role.rolePermissions) {
          for (const rolePermission of role.rolePermissions) {
            if (rolePermission.permission && rolePermission.isGranted !== false) {
              const permission = rolePermission.permission;
              const permString = `${permission.resourceName}:${permission.actionName}`;
              if (!permissions.includes(permString)) {
                permissions.push(permString);
              }
            }
          }
        }
      }

      // Add group permissions
      for (const group of user.groups || []) {
        if (group.groupPermissions) {
          for (const groupPermission of group.groupPermissions) {
            if (groupPermission.permission && groupPermission.isGranted !== false) {
              const permission = groupPermission.permission;
              const permString = `${permission.resourceName}:${permission.actionName}`;
              if (!permissions.includes(permString)) {
                permissions.push(permString);
              }
            }
          }
        }
      }

      // Add direct user permissions
      for (const userPermission of user.userPermissions || []) {
        if (userPermission.permission && userPermission.isGranted !== false) {
          const permission = userPermission.permission;
          const permString = `${permission.resourceName}:${permission.actionName}`;
          if (!permissions.includes(permString)) {
            permissions.push(permString);
          }
        }
      }

      return permissions;
    }
  }
} 