import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resource } from '../../modules/permissions/entities/resource.entity';
import { Action } from '../../modules/permissions/entities/action.entity';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { RolePermission } from '../../modules/permissions/entities/role-permission.entity';
import { Role, SystemRoles } from '../../modules/users/entities/role.entity';
import { Logger } from '@nestjs/common';

@Injectable()
export class PermissionSeedService {
  private readonly logger = new Logger(PermissionSeedService.name);

  constructor(
    @InjectRepository(Resource)
    private resourceRepository: Repository<Resource>,
    @InjectRepository(Action)
    private actionRepository: Repository<Action>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {}

  async seed() {
    this.logger.log('Starting permission seed...');

    // Create default resources first
    const resources = [
      { name: 'users', description: 'User management' },
      { name: 'roles', description: 'Role management' },
      { name: 'groups', description: 'Group management' },
      { name: 'permissions', description: 'Permission management' },
      { name: 'settings', description: 'System settings' },
      { name: 'dashboard', description: 'Dashboard' },
    ];

    for (const resource of resources) {
      const existingResource = await this.resourceRepository.findOne({
        where: { name: resource.name },
      });

      if (!existingResource) {
        await this.resourceRepository.save({
          name: resource.name,
          description: resource.description,
        });
        this.logger.log(`Created resource: ${resource.name}`);
      }
    }

    // Create default actions first (required for permissions)
    const actions = [
      {
        name: 'View',
        actionCode: 'view',
        description: 'View resource',
        category: 'read',
      },
      {
        name: 'Create',
        actionCode: 'create',
        description: 'Create new resource',
        category: 'write',
      },
      {
        name: 'Edit',
        actionCode: 'edit',
        description: 'Edit existing resource',
        category: 'write',
      },
      {
        name: 'Delete',
        actionCode: 'delete',
        description: 'Delete resource',
        category: 'write',
      },
      {
        name: 'Refresh',
        actionCode: 'refresh',
        description: 'Refresh resource',
        category: 'action',
      },
      {
        name: 'Test',
        actionCode: 'test',
        description: 'Test resource',
        category: 'action',
      },
    ];

    const actionMap = new Map<string, number>();
    for (const action of actions) {
      let existingAction = await this.actionRepository.findOne({
        where: { actionCode: action.actionCode },
      });

      if (!existingAction) {
        existingAction = await this.actionRepository.save({
          name: action.name,
          actionCode: action.actionCode,
          description: action.description,
          category: action.category,
        });
        this.logger.log(`Created action: ${action.actionCode}`);
      }
      actionMap.set(action.actionCode, existingAction.id);
    }

    // Create default permissions using action_id (foreign key)
    const permissions = [
      // User management permissions
      {
        resourceName: 'users',
        actionId: actionMap.get('view'),
        name: 'users:view',
        description: 'View users',
      },
      {
        resourceName: 'users',
        actionId: actionMap.get('create'),
        name: 'users:create',
        description: 'Create users',
      },
      {
        resourceName: 'users',
        actionId: actionMap.get('edit'),
        name: 'users:edit',
        description: 'Edit users',
      },
      {
        resourceName: 'users',
        actionId: actionMap.get('delete'),
        name: 'users:delete',
        description: 'Delete users',
      },

      // Role management permissions
      {
        resourceName: 'roles',
        actionId: actionMap.get('view'),
        name: 'roles:view',
        description: 'View roles',
      },
      {
        resourceName: 'roles',
        actionId: actionMap.get('create'),
        name: 'roles:create',
        description: 'Create roles',
      },
      {
        resourceName: 'roles',
        actionId: actionMap.get('edit'),
        name: 'roles:edit',
        description: 'Edit roles',
      },
      {
        resourceName: 'roles',
        actionId: actionMap.get('delete'),
        name: 'roles:delete',
        description: 'Delete roles',
      },

      // Group management permissions
      {
        resourceName: 'groups',
        actionId: actionMap.get('view'),
        name: 'groups:view',
        description: 'View groups',
      },
      {
        resourceName: 'groups',
        actionId: actionMap.get('create'),
        name: 'groups:create',
        description: 'Create groups',
      },
      {
        resourceName: 'groups',
        actionId: actionMap.get('edit'),
        name: 'groups:edit',
        description: 'Edit groups',
      },
      {
        resourceName: 'groups',
        actionId: actionMap.get('delete'),
        name: 'groups:delete',
        description: 'Delete groups',
      },

      // Permission management permissions
      {
        resourceName: 'permissions',
        actionId: actionMap.get('view'),
        name: 'permissions:view',
        description: 'View permissions',
      },
      {
        resourceName: 'permissions',
        actionId: actionMap.get('edit'),
        name: 'permissions:edit',
        description: 'Edit permissions',
      },
      {
        resourceName: 'permissions',
        actionId: actionMap.get('refresh'),
        name: 'permissions:refresh',
        description: 'Refresh permissions cache',
      },
      {
        resourceName: 'permissions',
        actionId: actionMap.get('test'),
        name: 'permissions:test',
        description: 'Test permissions',
      },

      // Settings permissions
      {
        resourceName: 'settings',
        actionId: actionMap.get('view'),
        name: 'settings:view',
        description: 'View system settings',
      },
      {
        resourceName: 'settings',
        actionId: actionMap.get('edit'),
        name: 'settings:edit',
        description: 'Edit system settings',
      },

      // Dashboard permissions
      {
        resourceName: 'dashboard',
        actionId: actionMap.get('view'),
        name: 'dashboard:view',
        description: 'View dashboard',
      },
      {
        resourceName: 'dashboard',
        actionId: actionMap.get('edit'),
        name: 'dashboard:edit',
        description: 'Edit dashboard',
      },
    ];

    for (const permission of permissions) {
      const existingPermission = await this.permissionRepository.findOne({
        where: { name: permission.name },
      });

      if (!existingPermission) {
        await this.permissionRepository.save({
          name: permission.name,
          description: permission.description,
          resourceName: permission.resourceName,
          actionId: permission.actionId,
        });
        this.logger.log(`Created permission: ${permission.name}`);
      }
    }

    // Assign permissions to roles
    await this.assignPermissionsToRoles();

    this.logger.log('Permission seed completed successfully');
  }

  private async assignPermissionsToRoles() {
    // Get roles
    const superadminRole = await this.roleRepository.findOne({
      where: { name: SystemRoles.SUPERADMIN },
    });

    const adminRole = await this.roleRepository.findOne({
      where: { name: SystemRoles.ADMIN },
    });

    const userRole = await this.roleRepository.findOne({
      where: { name: SystemRoles.USER },
    });

    if (!superadminRole || !adminRole || !userRole) {
      this.logger.error(
        'Required roles not found. Skipping permission assignment',
      );
      return;
    }

    // Define permissions for each role
    const rolePermissions = {
      [SystemRoles.SUPERADMIN]: [
        'users:view',
        'users:create',
        'users:edit',
        'users:delete',
        'roles:view',
        'roles:create',
        'roles:edit',
        'roles:delete',
        'groups:view',
        'groups:create',
        'groups:edit',
        'groups:delete',
        'permissions:view',
        'permissions:edit',
        'permissions:refresh',
        'permissions:test',
        'settings:view',
        'settings:edit',
        'dashboard:view',
        'dashboard:edit',
      ],
      [SystemRoles.ADMIN]: [
        'users:view',
        'users:create',
        'users:edit',
        'users:delete',
        'roles:view',
        'roles:create',
        'roles:edit',
        'roles:delete',
        'groups:view',
        'groups:create',
        'groups:edit',
        'groups:delete',
        'permissions:view',
        'permissions:edit',
        'permissions:refresh',
        'permissions:test',
        'settings:view',
        'settings:edit',
        'dashboard:view',
        'dashboard:edit',
      ],
      [SystemRoles.USER]: ['users:view', 'dashboard:view'],
    };

    // Assign permissions to roles using correct field names
    for (const [roleName, permissionKeys] of Object.entries(rolePermissions)) {
      let role: Role;

      if (roleName === SystemRoles.SUPERADMIN) {
        role = superadminRole;
      } else if (roleName === SystemRoles.ADMIN) {
        role = adminRole;
      } else if (roleName === SystemRoles.USER) {
        role = userRole;
      } else {
        continue;
      }

      for (const permissionKey of permissionKeys) {
        const permission = await this.permissionRepository.findOne({
          where: { name: permissionKey },
        });

        if (!permission) {
          this.logger.warn(`Permission not found: ${permissionKey}`);
          continue;
        }

        // Check if role permission already exists using correct field names
        const existingRolePermission =
          await this.rolePermissionRepository.findOne({
            where: {
              roleId: role.id,
              permissionId: permission.id,
            },
          });

        if (!existingRolePermission) {
          await this.rolePermissionRepository.save({
            roleId: role.id,
            permissionId: permission.id,
            isGranted: true,
          });

          this.logger.log(
            `Assigned permission ${permissionKey} to role ${roleName}`,
          );
        }
      }
    }
  }
}
