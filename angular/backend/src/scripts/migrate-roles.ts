import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Role } from '../modules/permissions/entities/role.entity';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { RolePermission } from '../modules/permissions/entities/role-permission.entity';
import { GroupPermission } from '../modules/permissions/entities/group-permission.entity';
import { UserPermission } from '../modules/permissions/entities/user-permission.entity';
import { Group } from '../modules/permissions/entities/group.entity';
import { UiComponent } from '../modules/permissions/entities/ui-component.entity';
import { FrontendRoute } from '../modules/permissions/entities/frontend-route.entity';
import { ApiEndpoint } from '../modules/permissions/entities/api-endpoint.entity';
import { User } from '../modules/users/entities/user.entity';
import { UserGroup } from '../modules/users/entities/user-group.entity';
import { Injectable } from '@nestjs/common';
import environmentConfig from '../config/environment.config';
import { DataSource } from 'typeorm';

// Create logger wrapper that logs to both console and file
class MigrationLogger extends Logger {
  private fileLogger: fs.WriteStream;
  private debugMode: boolean;

  constructor(context: string, debugMode: boolean = false) {
    super(context);
    this.debugMode = debugMode;

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir);
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const logPath = path.join(logsDir, `role-migration-${timestamp}.log`);
    this.fileLogger = fs.createWriteStream(logPath, { flags: 'a' });
    this.log(`Log file created at: ${logPath}`);
  }

  log(message: string) {
    super.log(message);
    this.writeToFile('INFO', message);
  }

  error(message: string, trace?: string) {
    super.error(message, trace);
    this.writeToFile('ERROR', message);
    if (trace) {
      this.writeToFile('ERROR', trace);
    }
  }

  warn(message: string) {
    super.warn(message);
    this.writeToFile('WARN', message);
  }

  debug(message: string) {
    if (this.debugMode) {
      super.debug(message);
      this.writeToFile('DEBUG', message);
    }
  }

  verbose(message: string) {
    if (this.debugMode) {
      super.verbose(message);
      this.writeToFile('VERBOSE', message);
    }
  }

  private writeToFile(level: string, message: string) {
    const timestamp = new Date().toISOString();
    this.fileLogger.write(`[${timestamp}] [${level}] ${message}\n`);
  }

  close() {
    this.fileLogger.end();
  }
}

// Model the role-to-permission mapping
interface RolePermissionMapping {
  role: string;
  permissions: string[];
}

// Define mappings from roles to permissions
const rolesToPermissions: RolePermissionMapping[] = [
  {
    role: 'ADMIN',
    permissions: [
      'user:create',
      'user:read',
      'user:update',
      'user:delete',
      'role:create',
      'role:read',
      'role:update',
      'role:delete',
      'permission:create',
      'permission:read',
      'permission:update',
      'permission:delete',
      'report:create',
      'report:read',
      'report:update',
      'report:delete',
      'system:settings:read',
      'system:settings:update',
    ],
  },
  {
    role: 'USER',
    permissions: ['user:read', 'role:read', 'permission:read', 'report:read'],
  },
  {
    role: 'MANAGER',
    permissions: [
      'user:read',
      'user:update',
      'role:read',
      'permission:read',
      'report:create',
      'report:read',
      'report:update',
    ],
  },
  {
    role: 'AUDITOR',
    permissions: [
      'user:read',
      'role:read',
      'permission:read',
      'report:read',
      'system:audit:read',
    ],
  },
];

@Injectable()
class RoleMigrationSeed {
  private readonly logger: MigrationLogger;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    // Get debug mode from config
    const debugMode = this.configService.get('migration.debug') === 'true';
    this.logger = new MigrationLogger('RoleMigrationSeed', debugMode);
  }

  async run() {
    try {
      this.logger.log('Starting role to permission migration...');

      // Use the injected connection instead of a global connection
      if (!this.dataSource || !this.dataSource.isInitialized) {
        throw new Error('Database connection not available');
      }

      this.logger.log('Database connection established');

      // Repositories
      const roleRepository = this.dataSource.getRepository(Role);
      const permissionRepository = this.dataSource.getRepository(Permission);
      const rolePermissionRepository =
        this.dataSource.getRepository(RolePermission);

      this.logger.log('Repositories initialized');

      // Process each role-to-permission mapping
      for (const mapping of rolesToPermissions) {
        this.logger.log(`Processing role: ${mapping.role}`);

        // Find the role
        const role = await roleRepository.findOne({
          where: { name: mapping.role },
        });
        if (!role) {
          this.logger.warn(`Role '${mapping.role}' not found, skipping...`);
          continue;
        }

        // Process each permission for this role
        for (const permissionName of mapping.permissions) {
          this.logger.debug(`Looking up permission: ${permissionName}`);

          // Find the permission
          const permission = await permissionRepository.findOne({
            where: { name: permissionName },
          });

          if (!permission) {
            this.logger.warn(
              `Permission '${permissionName}' not found, skipping...`,
            );
            continue;
          }

          // Check if the role-permission mapping already exists
          const existingMapping = await rolePermissionRepository.findOne({
            where: {
              roleId: role.id,
              permissionId: permission.id,
            },
          });

          if (existingMapping) {
            this.logger.debug(
              `Mapping already exists for role '${role.name}' and permission '${permission.name}'`,
            );
            continue;
          }

          // Create new role-permission mapping
          const rolePermission = new RolePermission();
          rolePermission.roleId = role.id;
          rolePermission.permissionId = permission.id;

          await rolePermissionRepository.save(rolePermission);
          this.logger.log(
            `Added permission '${permission.name}' to role '${role.name}'`,
          );
        }
      }

      this.logger.log('Role to permission migration completed successfully');
      return true;
    } catch (error) {
      this.logger.error(`Migration failed: ${error.message}`, error.stack);
      return false;
    } finally {
      this.logger.close();
    }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [environmentConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'sqlite',
        database: configService.get('DATABASE_FILE', 'db.sqlite'),
        entities: [
          Role,
          Permission,
          RolePermission,
          GroupPermission,
          UserPermission,
          Group,
          UiComponent,
          FrontendRoute,
          ApiEndpoint,
          User,
          UserGroup,
        ],
        synchronize: false,
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Role, Permission, RolePermission]),
  ],
  providers: [RoleMigrationSeed],
})
export class MigrationModule {}

async function bootstrap() {
  const logger = new MigrationLogger('Bootstrap');
  try {
    logger.log('Initializing role migration application...');
    const app = await NestFactory.createApplicationContext(MigrationModule);

    // Run migration
    logger.log('Executing role migration...');
    const migrationService = app.get(RoleMigrationSeed);
    const result = await migrationService.run();

    if (result) {
      logger.log('Migration completed successfully');
      await app.close();
      process.exit(0);
    } else {
      logger.error('Migration failed');
      await app.close();
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Bootstrap error: ${error.message}`, error.stack);
    process.exit(1);
  } finally {
    logger.close();
  }
}

bootstrap();
