import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { Role } from '../../modules/roles/entities/role.entity';
import { RolePermission } from '../../modules/roles/entities/role-permission.entity';
import { Action } from '../../modules/permissions/entities/action.entity';
import { PermissionsService } from '../../modules/permissions/services/permissions.service';
import { Connection } from 'typeorm';
import { Logger } from '@nestjs/common';
import { In } from 'typeorm';

@Injectable()
export class PermissionSeedsService {
  private readonly logger = new Logger(PermissionSeedsService.name);

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
    private connection: Connection,
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
    const actionRepository = this.connection.getRepository(Action);
    const permissionRepository = this.connection.getRepository(Permission);

    // Define all valid resource-action combinations
    const validCombinations = [
      // Users permissions
      {
        resource: 'users',
        actions: ['create', 'view', 'update', 'delete', 'list', 'manage', 'admin'],
      },
      // Roles permissions
      {
        resource: 'roles',
        actions: ['create', 'view', 'update', 'delete', 'list', 'manage', 'admin'],
      },
      // Groups permissions
      {
        resource: 'groups',
        actions: ['create', 'view', 'update', 'delete', 'list', 'manage', 'admin'],
      },
      // Group members permissions
      {
        resource: 'groups:members',
        actions: ['add', 'remove', 'update', 'view'],
      },
      // Group settings permissions
      {
        resource: 'groups:settings',
        actions: ['update'],
      },
      // Permissions management
      {
        resource: 'permissions',
        actions: ['create', 'view', 'update', 'delete', 'list', 'manage', 'admin'],
      },
      // Self profile permissions
      {
        resource: 'self:profile',
        actions: ['read', 'update'],
      },
      // System permissions
      {
        resource: 'system',
        actions: ['admin', 'manage'],
      },
      // Login monitoring permissions
      {
        resource: 'login-monitoring',
        actions: ['view', 'manage'],
      },
    ];

    // Get all existing actions
    const actions = await actionRepository.find();
    const actionMap = new Map(actions.map(action => [action.actionCode, action]));

    // Create permissions for each valid combination
    for (const combination of validCombinations) {
      for (const actionCode of combination.actions) {
        const action = actionMap.get(actionCode);
        if (!action) {
          this.logger.warn(`Action ${actionCode} not found in actions table`);
          continue;
        }

        const permissionName = `${combination.resource}:${actionCode}`;
        const existingPermission = await permissionRepository.findOne({
          where: {
            resourceName: combination.resource,
            actionId: action.id,
          },
        });

        if (!existingPermission) {
          const permission = new Permission();
          permission.name = permissionName;
          permission.resourceName = combination.resource;
          permission.actionId = action.id;
          permission.description = `Permission to ${action.description?.toLowerCase() || actionCode} ${combination.resource}`;
          
          try {
            await permissionRepository.save(permission);
            this.logger.log(`Created permission: ${permissionName}`);
          } catch (error) {
            this.logger.error(`Failed to create permission ${permissionName}: ${error.message}`);
          }
        }
      }
    }
  }

  /**
   * Seed role permissions
   */
  private async seedRolePermissions() {
    const rolePermissionMap = {
      // Regular user permissions
      user: [
        'users:view',
        'dashboard:view',
        'self:profile:read',
        'self:profile:update'
      ],

      // Admin permissions
      admin: [
        'users:create',
        'users:view',
        'users:update',
        'users:list',
        'groups:manage',
        'groups:members:view',
        'groups:members:add',
        'groups:members:remove',
        'groups:settings:update',
        'roles:view',
        'roles:list',
        'permissions:view',
        'permissions:list',
        'system:manage'
      ],

      // Super Administrator permissions
      superadmin: [
        // User management
        'users:create', 'users:view', 'users:update', 'users:delete', 'users:list', 'users:manage', 'users:admin',
        
        // Role management
        'roles:create', 'roles:view', 'roles:update', 'roles:delete', 'roles:list', 'roles:manage', 'roles:admin',
        
        // Group management
        'groups:create', 'groups:view', 'groups:update', 'groups:delete', 'groups:list', 'groups:manage', 'groups:admin',
        'groups:members:add', 'groups:members:remove', 'groups:members:update', 'groups:members:view',
        'groups:settings:update',
        
        // Permission management
        'permissions:create', 'permissions:view', 'permissions:update', 'permissions:delete', 'permissions:list', 'permissions:manage', 'permissions:admin',
        
        // Profile management
        'self:profile:read', 'self:profile:update',
        
        // System management
        'system:admin', 'system:manage',
        
        // Login monitoring
        'login-monitoring:view', 'login-monitoring:manage'
      ]
    };

    // Create roles and assign permissions
    for (const [roleName, permissions] of Object.entries(rolePermissionMap)) {
      let role = await this.roleRepository.findOne({ where: { name: roleName } });
      
      if (!role) {
        role = await this.roleRepository.save({
          name: roleName,
          description: `${roleName.charAt(0).toUpperCase() + roleName.slice(1)} role with predefined permissions`,
        });
        this.logger.log(`Created role: ${roleName}`);
      }

      // Get all permission entities for this role
      const permissionEntities = await this.permissionRepository.find({
        where: {
          name: In(permissions)
        }
      });

      // Create role-permission associations
      for (const permission of permissionEntities) {
        const existingRolePermission = await this.rolePermissionRepository.findOne({
          where: {
            roleId: role.id,
            permissionId: permission.id
          }
        });

        if (!existingRolePermission) {
          await this.rolePermissionRepository.save({
            roleId: role.id,
            permissionId: permission.id,
            isGranted: true
          });
          this.logger.log(`Assigned permission ${permission.name} to role ${roleName}`);
        }
      }
    }
  }
}
