import { NestFactory } from '@nestjs/core';
import { Module, Injectable } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Action } from '../modules/permissions/entities/action.entity';
import { Role } from '../modules/users/entities/role.entity';
import { RolePermission } from '../modules/permissions/entities/role-permission.entity';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';

class SeedLogger extends Logger {
  private logFile: string;

  constructor() {
    super('RoleSeed');
    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(logDir, 'role-seed.log');
  }

  private writeToFile(message: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(this.logFile, `${timestamp} - ${message}\n`);
  }

  log(message: string) {
    super.log(message);
    this.writeToFile(`[INFO] ${message}`);
  }

  error(message: string, trace?: string) {
    super.error(message, trace);
    this.writeToFile(`[ERROR] ${message}${trace ? `\n${trace}` : ''}`);
  }

  warn(message: string) {
    super.warn(message);
    this.writeToFile(`[WARN] ${message}`);
  }

  debug(message: string) {
    super.debug(message);
    this.writeToFile(`[DEBUG] ${message}`);
  }

  verbose(message: string) {
    super.verbose(message);
    this.writeToFile(`[VERBOSE] ${message}`);
  }
}

const actionsToSeed = [
  { name: 'Create', actionCode: 'create', description: 'Create new resource', category: 'write' },
  { name: 'Read', actionCode: 'read', description: 'View resource details', category: 'read' },
  { name: 'Update', actionCode: 'update', description: 'Update resource details', category: 'write' },
  { name: 'Delete', actionCode: 'delete', description: 'Delete resource', category: 'write' },
  { name: 'List', actionCode: 'list', description: 'List all resources', category: 'read' },
  { name: 'Assign', actionCode: 'assign', description: 'Assign resource to users', category: 'action' },
  { name: 'Export', actionCode: 'export', description: 'Export resource data', category: 'action' },
  { name: 'Config', actionCode: 'config', description: 'Configure resource', category: 'action' },
  { name: 'Audit', actionCode: 'audit', description: 'View resource audit logs', category: 'read' },
  { name: 'Backup', actionCode: 'backup', description: 'Manage resource backups', category: 'action' },
];

const permissionsToSeed = [
  // User Management
  {
    name: 'user:create',
    description: 'Create new users',
    resourceName: 'user',
    actionCode: 'create',
  },
  {
    name: 'user:read',
    description: 'View user details',
    resourceName: 'user',
    actionCode: 'read',
  },
  {
    name: 'user:update',
    description: 'Update user details',
    resourceName: 'user',
    actionCode: 'update',
  },
  {
    name: 'user:delete',
    description: 'Delete users',
    resourceName: 'user',
    actionCode: 'delete',
  },
  {
    name: 'user:list',
    description: 'List all users',
    resourceName: 'user',
    actionCode: 'list',
  },

  // Permission Management
  {
    name: 'permission:create',
    description: 'Create new permissions',
    resourceName: 'permission',
    actionCode: 'create',
  },
  {
    name: 'permission:read',
    description: 'View permission details',
    resourceName: 'permission',
    actionCode: 'read',
  },
  {
    name: 'permission:update',
    description: 'Update permission details',
    resourceName: 'permission',
    actionCode: 'update',
  },
  {
    name: 'permission:delete',
    description: 'Delete permissions',
    resourceName: 'permission',
    actionCode: 'delete',
  },
  {
    name: 'permission:list',
    description: 'List all permissions',
    resourceName: 'permission',
    actionCode: 'list',
  },
  {
    name: 'permission:assign',
    description: 'Assign permissions to users',
    resourceName: 'permission',
    actionCode: 'assign',
  },

  // Report Management
  {
    name: 'report:create',
    description: 'Create new reports',
    resourceName: 'report',
    actionCode: 'create',
  },
  {
    name: 'report:read',
    description: 'View report details',
    resourceName: 'report',
    actionCode: 'read',
  },
  {
    name: 'report:update',
    description: 'Update report details',
    resourceName: 'report',
    actionCode: 'update',
  },
  {
    name: 'report:delete',
    description: 'Delete reports',
    resourceName: 'report',
    actionCode: 'delete',
  },
  {
    name: 'report:list',
    description: 'List all reports',
    resourceName: 'report',
    actionCode: 'list',
  },
  {
    name: 'report:export',
    description: 'Export reports',
    resourceName: 'report',
    actionCode: 'export',
  },

  // System Management
  {
    name: 'system:config',
    description: 'Manage system configuration',
    resourceName: 'system',
    actionCode: 'config',
  },
  {
    name: 'system:audit',
    description: 'View system audit logs',
    resourceName: 'system',
    actionCode: 'audit',
  },
  {
    name: 'system:backup',
    description: 'Manage system backups',
    resourceName: 'system',
    actionCode: 'backup',
  },
];

const rolesToSeed = [
  {
    name: 'ADMIN',
    description: 'System Administrator',
    isSystemRole: true,
    isDefault: false,
    permissions: ['*'], // All permissions
    parentRole: null,
  },
  {
    name: 'USER',
    description: 'Regular User',
    isSystemRole: true,
    isDefault: true,
    permissions: ['user:read', 'user:update', 'report:read', 'report:list'],
    parentRole: null,
  },
  {
    name: 'MANAGER',
    description: 'Team Manager',
    isSystemRole: true,
    isDefault: false,
    permissions: [
      'user:read',
      'user:list',
      'report:create',
      'report:read',
      'report:update',
      'report:list',
      'report:export',
    ],
    parentRole: 'USER',
  },
  {
    name: 'AUDITOR',
    description: 'System Auditor',
    isSystemRole: true,
    isDefault: false,
    permissions: [
      'system:audit',
      'report:read',
      'report:list',
      'report:export',
    ],
    parentRole: null,
  },
];

@Injectable()
class RoleSeedService {
  private readonly logger = new SeedLogger();

  constructor(
    @InjectRepository(Action)
    private actionRepository: Repository<Action>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
    private dataSource: DataSource,
  ) {}

  private async validateRoleHierarchy(
    roles: typeof rolesToSeed,
  ): Promise<boolean> {
    const roleMap = new Map<string, string>();

    // Build role hierarchy map
    for (const role of roles) {
      if (role.parentRole) {
        roleMap.set(role.name, role.parentRole);
      }
    }

    // Check for circular dependencies
    for (const role of roles) {
      const visited = new Set<string>();
      let current = role.name;

      while (current) {
        if (visited.has(current)) {
          this.logger.error(
            `Circular dependency detected in role hierarchy starting from ${role.name}`,
          );
          return false;
        }
        visited.add(current);
        current = roleMap.get(current);
      }
    }

    return true;
  }

  private async validatePermissions(permissions: string[]): Promise<boolean> {
    if (permissions.includes('*')) {
      return true;
    }

    const existingPermissions = await this.permissionRepository.find();
    const existingPermissionNames = existingPermissions.map((p) => p.name);

    for (const permission of permissions) {
      if (!existingPermissionNames.includes(permission)) {
        this.logger.error(`Invalid permission: ${permission}`);
        return false;
      }
    }

    return true;
  }

  private async createRoleWithPermissions(
    queryRunner: QueryRunner,
    roleData: (typeof rolesToSeed)[0],
    permissionMap: Map<string, Permission>,
  ): Promise<Role> {
    // Create role
    const role = this.roleRepository.create({
      name: roleData.name,
      description: roleData.description,
      isSystemRole: roleData.isSystemRole,
      isDefault: roleData.isDefault,
    });

    if (roleData.parentRole) {
      const parentRole = await queryRunner.manager.findOne(Role, {
        where: { name: roleData.parentRole },
      });
      if (parentRole) {
        role.parentId = parentRole.id;
      }
    }

    await queryRunner.manager.save(Role, role);

    // Assign permissions
    if (roleData.permissions.includes('*')) {
      // Assign all permissions
      for (const permission of permissionMap.values()) {
        const rolePermission = this.rolePermissionRepository.create({
          roleId: role.id,
          permissionId: permission.id,
          isGranted: true,
        });
        await queryRunner.manager.save(RolePermission, rolePermission);
      }
    } else {
      // Assign specific permissions
      for (const permissionName of roleData.permissions) {
        const permission = permissionMap.get(permissionName);
        if (permission) {
          const rolePermission = this.rolePermissionRepository.create({
            roleId: role.id,
            permissionId: permission.id,
            isGranted: true,
          });
          await queryRunner.manager.save(RolePermission, rolePermission);
        }
      }
    }

    return role;
  }

  async run() {
    this.logger.log('Starting role and permission seeding process...');
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      // Start transaction
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Validate role hierarchy
      if (!(await this.validateRoleHierarchy(rolesToSeed))) {
        throw new Error('Invalid role hierarchy detected');
      }

      // Seed actions first
      const actionMap = new Map<string, number>();
      for (const actionData of actionsToSeed) {
        let action = await queryRunner.manager.findOne(Action, {
          where: { actionCode: actionData.actionCode },
        });

        if (!action) {
          action = this.actionRepository.create(actionData);
          action = await queryRunner.manager.save(Action, action);
          this.logger.log(`Created action: ${action.actionCode}`);
        }
        actionMap.set(action.actionCode, action.id);
      }

      // Seed permissions
      const permissionMap = new Map<string, Permission>();
      for (const permissionData of permissionsToSeed) {
        let permission = await queryRunner.manager.findOne(Permission, {
          where: { name: permissionData.name },
        });

        if (!permission) {
          const actionId = actionMap.get(permissionData.actionCode);
          if (!actionId) {
            throw new Error(`Action not found for permission: ${permissionData.name}`);
          }

          permission = this.permissionRepository.create({
            name: permissionData.name,
            description: permissionData.description,
            resourceName: permissionData.resourceName,
            actionId: actionId,
          });
          permission = await queryRunner.manager.save(Permission, permission);
          this.logger.log(`Created permission: ${permission.name}`);
        }
        permissionMap.set(permission.name, permission);
      }

      // Validate permissions in roles
      for (const roleData of rolesToSeed) {
        if (!(await this.validatePermissions(roleData.permissions))) {
          throw new Error(`Invalid permissions found in role ${roleData.name}`);
        }
      }

      // Seed roles
      for (const roleData of rolesToSeed) {
        const existingRole = await queryRunner.manager.findOne(Role, {
          where: { name: roleData.name },
        });

        if (!existingRole) {
          const role = await this.createRoleWithPermissions(
            queryRunner,
            roleData,
            permissionMap,
          );
          this.logger.log(`Created role: ${role.name}`);
        } else {
          this.logger.warn(
            `Role ${roleData.name} already exists, updating permissions...`,
          );
          // Update existing role's permissions
          await queryRunner.manager.delete(RolePermission, {
            roleId: existingRole.id,
          });
          await this.createRoleWithPermissions(
            queryRunner,
            roleData,
            permissionMap,
          );
        }
      }

      // Commit transaction
      await queryRunner.commitTransaction();
      this.logger.log('Role and permission seeding completed successfully');
    } catch (error) {
      // Rollback transaction on error
      this.logger.error(
        'Error during role and permission seeding:',
        error.stack,
      );
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
        this.logger.log('Transaction rolled back due to error');
      }
      throw error;
    } finally {
      // Release query runner
      await queryRunner.release();
    }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'db.sqlite',
      entities: [Action, Permission, Role, RolePermission],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Action, Permission, Role, RolePermission]),
  ],
  providers: [RoleSeedService],
})
class SeedModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SeedModule);
  const logger = new SeedLogger();

  try {
    const seedService = app.get(RoleSeedService);
    await seedService.run();
    logger.log('Role and permission seeding completed successfully');
  } catch (error) {
    logger.error('Role and permission seeding failed:', error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
