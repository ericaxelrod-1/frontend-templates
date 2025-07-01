import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Role } from '../modules/roles/entities/role.entity';
import { UiComponent } from '../modules/permissions/entities/ui-component.entity';
import { FrontendRoute } from '../modules/permissions/entities/frontend-route.entity';
import { ApiEndpoint } from '../modules/permissions/entities/api-endpoint.entity';
import { GroupPermission } from '../modules/permissions/entities/group-permission.entity';
import { UserPermission } from '../modules/permissions/entities/user-permission.entity';
import { RolePermission } from '../modules/roles/entities/role-permission.entity';
import { User } from '../modules/users/entities/user.entity';
import { Group } from '../modules/permissions/entities/group.entity';

import { Action } from '../modules/permissions/entities/action.entity';
import { Resource } from '../modules/permissions/entities/resource.entity';
import { LoginAttempt } from '../modules/auth/entities/login-attempt.entity';
import { IPReputation } from '../modules/auth/entities/ip-reputation.entity';
import { Captcha } from '../modules/auth/entities/captcha.entity';

// Load environment variables from .env file
config();

// Define database configuration
export const dataSourceOptions: DataSourceOptions = {
  type: 'sqlite',
  database: process.env.DATABASE_FILE || 'db.sqlite',
  entities: [
    Permission,
    Role,
    Group,
    UiComponent,
    FrontendRoute,
    ApiEndpoint,
    GroupPermission,
    UserPermission,
    RolePermission,
    User,
    Action,
    Resource,
    LoginAttempt,
    IPReputation,
    Captcha,
  ],
  migrations: ['src/database/migrations/*{.ts,.js}'],
  synchronize: false, // Disable synchronize as we're handling schema manually
  migrationsRun: false, // Disable migrations as we're handling them manually
  logging: ['query', 'error', 'schema'], // Added 'schema' logging
};

// Create and export TypeORM data source
const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
