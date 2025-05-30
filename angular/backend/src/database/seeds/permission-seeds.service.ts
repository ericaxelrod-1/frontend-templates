import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { Role } from '../../modules/roles/entities/role.entity';
import { RolePermission } from '../../modules/roles/entities/role-permission.entity';
import { Action } from '../../modules/permissions/entities/action.entity';
import { PermissionsService } from '../../modules/permissions/services/permissions.service';

@Injectable()
export class PermissionSeedsService {
  constructor(
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Action)
    private actionRepository: Repository<Action>,
    private permissionsService: PermissionsService,
  ) {}

  /**
   * Seed permissions data
   */
  async seed() {
    await this.seedPermissions();
    await this.seedRolePermissions();
  }

  /**
   * Seed permissions
   */
  private async seedPermissions() {
    console.log('Seeding permissions...');

    // Define valid combinations of resources and actions
    const validCombinations = [
      // Users permissions
      {
        resource: 'users',
        actions: ['create', 'read', 'update', 'delete', 'list', 'manage'],
      },
      // Roles permissions
      {
        resource: 'roles',
        actions: ['create', 'read', 'update', 'delete', 'list', 'manage'],
      },
      // Groups permissions
      {
        resource: 'groups',
        actions: ['create', 'read', 'update', 'delete', 'list', 'manage'],
      },
      // Permissions management
      { resource: 'permissions', actions: ['read', 'update', 'manage'] },
      // Reports
      { resource: 'reports', actions: ['read', 'list', 'export'] },
      // Dashboard
      { resource: 'dashboard', actions: ['read'] },
      // Settings
      { resource: 'settings', actions: ['read', 'update', 'manage'] },
    ];

    for (const combination of validCombinations) {
      const resourceName = combination.resource;

      for (const actionName of combination.actions) {
        // Find or create the Action entity
        let action = await this.actionRepository.findOne({
          where: { name: actionName },
        });

        if (!action) {
          action = await this.actionRepository.save({
            name: actionName,
            actionCode: actionName,
            description: `${actionName} action`,
          });
          console.log(`Created action: ${actionName}`);
        }

        // Check if permission already exists
        const existingPermission = await this.permissionRepository.findOne({
          where: {
            resourceName,
            actionId: action.id,
          },
        });

        if (!existingPermission) {
          const name = `${resourceName}:${actionName}`;
          const description = `${actionName} ${resourceName}`;

          // Create permission with actionId reference
          const permissionData: DeepPartial<Permission> = {
            resourceName,
            actionId: action.id,
            name,
            description,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await this.permissionRepository.save(permissionData);
          console.log(`Created permission: ${name}`);
        }
      }
    }
  }

  /**
   * Seed role permissions
   */
  private async seedRolePermissions() {
    console.log('Seeding role permissions...');

    // Get all system roles
    const roles = await this.roleRepository.find({
      where: { isSystemRole: true },
    });

    // Get all permissions with their action relationships
    const permissions = await this.permissionRepository.find({
      relations: ['actionEntity'],
    });

    // Define permission assignments by role
    const rolePermissionMap = {
      // Regular user permissions
      user: ['users:read', 'dashboard:read'],

      // Admin permissions
      admin: [
        'users:create',
        'users:read',
        'users:update',
        'users:list',
        'groups:manage',
        'roles:read',
        'roles:list',
        'reports:read',
        'reports:list',
        'reports:export',
        'dashboard:read',
        'settings:read',
        'settings:update',
      ],

      // Superuser permissions
      superuser: [
        'users:create',
        'users:read',
        'users:update',
        'users:delete',
        'users:list',
        'users:manage',
        'groups:create',
        'groups:read',
        'groups:update',
        'groups:delete',
        'groups:list',
        'groups:manage',
        'roles:read',
        'roles:update',
        'roles:list',
        'permissions:read',
        'permissions:update',
        'reports:read',
        'reports:list',
        'reports:export',
        'dashboard:read',
        'settings:read',
        'settings:update',
      ],

      // Superadmin permissions (all permissions)
      superadmin: permissions.map((p) => `${p.resourceName}:${p.actionEntity?.name || ''}`),
    };

    // Assign permissions to roles
    for (const role of roles) {
      // Normalize role name: lowercase and remove spaces
      const normalizedRoleName = role.name.toLowerCase().replace(/\s+/g, '');
      const isSuperAdmin =
        normalizedRoleName === 'superadmin' ||
        normalizedRoleName === 'superadministrator';
      let permissionList = rolePermissionMap[role.name];
      if (isSuperAdmin) {
        permissionList = permissions.map((p) => `${p.resourceName}:${p.actionEntity?.name || ''}`);
      }
      if (permissionList) {
        for (const permissionStr of permissionList) {
          const [resourceName, actionName] = permissionStr.split(':');

          // Find the permission
          const permission = permissions.find(
            (p) =>
              p.resourceName === resourceName && p.actionEntity?.name === actionName,
          );

          if (permission) {
            // Check if role permission already exists
            const existingRolePermission =
              await this.rolePermissionRepository.findOne({
                where: {
                  roleId: role.id,
                  permissionId: permission.id,
                },
              });

            if (!existingRolePermission) {
              // Create role permission with numeric IDs
              const rolePermissionData: DeepPartial<RolePermission> = {
                roleId: role.id,
                permissionId: permission.id,
                isGranted: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              };

              await this.rolePermissionRepository.save(rolePermissionData);
              console.log(
                `Granted permission ${permissionStr} to role ${role.name}`,
              );
            }
          }
        }
      }
    }
  }
}
