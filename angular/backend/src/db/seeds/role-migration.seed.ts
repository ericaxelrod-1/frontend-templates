import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role, SystemRoles } from '../../modules/users/entities/role.entity';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { RolePermission } from '../../modules/permissions/entities/role-permission.entity';

/**
 * Migration seed to map system roles to permissions.
 * This ensures backward compatibility during the migration from role-based to permission-based access control.
 */
@Injectable()
export class RoleMigrationSeed {
  private readonly logger = new Logger(RoleMigrationSeed.name);

  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,

    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,

    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
  ) {}

  /**
   * Runs the migration to map system roles to permissions
   */
  async run(): Promise<void> {
    this.logger.log('Starting role to permission migration...');

    // Define the permissions for each system role
    const roleMappings = {
      [SystemRoles.SUPERADMIN]: [
        // Full system access permissions
        'users:create',
        'users:read',
        'users:update',
        'users:delete',
        'users:admin',
        'users:manage',
        'users:emulate',
        'roles:create',
        'roles:read',
        'roles:update',
        'roles:delete',
        'roles:admin',
        'roles:manage',
        'roles:assign',
        'groups:create',
        'groups:read',
        'groups:update',
        'groups:delete',
        'groups:admin',
        'groups:manage',
        'permissions:create',
        'permissions:read',
        'permissions:update',
        'permissions:delete',
        'permissions:admin',
        'permissions:manage',
        'system:admin',
        'system:config',
        'system:logs',
        'admin:access',
        'admin:dashboard',
      ],
      [SystemRoles.ADMIN]: [
        // Standard admin permissions
        'users:create',
        'users:read',
        'users:update',
        'users:manage',
        'roles:read',
        'groups:create',
        'groups:read',
        'groups:update',
        'groups:manage',
        'permissions:read',
        'admin:access',
        'admin:dashboard',
      ],
      [SystemRoles.USER]: [
        // Basic user permissions
        'users:read',
        'self:profile:update',
        'self:groups:manage',
      ],
    };

    // Process each role and assign permissions
    for (const [roleName, permissions] of Object.entries(roleMappings)) {
      await this.assignPermissionsToRole(roleName, permissions);
    }

    this.logger.log('Role to permission migration completed successfully');
  }

  /**
   * Assign a list of permissions to a role by name
   */
  private async assignPermissionsToRole(
    roleName: string,
    permissionNames: string[],
  ): Promise<void> {
    // Get the role
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });
    if (!role) {
      this.logger.warn(
        `Role ${roleName} not found, skipping permission assignment`,
      );
      return;
    }

    // Process each permission
    for (const permissionName of permissionNames) {
      const [resourceName, actionName] = permissionName.split(':');

      // Find or create the permission
      let permission = await this.permissionRepository.findOne({
        where: {
          resourceName,
          name: permissionName,
        },
      });

      if (!permission) {
        permission = this.permissionRepository.create({
          resourceName,
          name: permissionName,
          description: `Permission for ${permissionName}`,
          // Note: actionId should be set based on Action entity lookup
        });
        await this.permissionRepository.save(permission);
        this.logger.log(`Created permission: ${permissionName}`);
      }

      // Assign to role
      await this.assignPermissionToRole(role, permission);
    }

    this.logger.log(
      `Assigned ${permissionNames.length} permissions to role: ${roleName}`,
    );
  }

  /**
   * Assign a single permission to a role
   */
  private async assignPermissionToRole(
    role: Role,
    permission: Permission,
  ): Promise<void> {
    // Check if the role permission already exists
    const existing = await this.rolePermissionRepository.findOne({
      where: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });

    // Create the role permission if it doesn't exist
    if (!existing) {
      const rolePermission = this.rolePermissionRepository.create({
        roleId: role.id,
        permissionId: permission.id,
        isGranted: true,
      });
      await this.rolePermissionRepository.save(rolePermission);
    }
  }
}
