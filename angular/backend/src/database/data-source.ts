import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

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
import { RlsRule } from '../modules/permissions/entities/rls-rule.entity';
import { RlsConditionGroup } from '../modules/permissions/entities/rls-condition-group.entity';
import { RlsRuleCondition } from '../modules/permissions/entities/rls-rule-condition.entity';
import { RlsJoinPath } from '../modules/permissions/entities/rls-join-path.entity';
import { RlsJoinCondition } from '../modules/permissions/entities/rls-join-condition.entity';
import { RlsScopeTemplate } from '../modules/permissions/entities/rls-scope-template.entity';

import { Action } from '../modules/permissions/entities/action.entity';
import { Resource } from '../modules/permissions/entities/resource.entity';
import { LoginAttempt } from '../modules/auth/entities/login-attempt.entity';
import { IPReputation } from '../modules/auth/entities/ip-reputation.entity';
import { Captcha } from '../modules/auth/entities/captcha.entity';
import { RateLimitCounter } from '../modules/auth/entities/rate-limit-counter.entity';
import { UserBehaviorProfile } from '../modules/auth/entities/user-behavior-profile.entity';
import { SecurityAlert } from '../modules/auth/entities/security-alert.entity';
import { SecurityDetectedPattern } from '../modules/auth/entities/security-detected-pattern.entity';
import { PatternLoginAttempt } from '../modules/auth/entities/pattern-login-attempt.entity';

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
    RateLimitCounter,
    UserBehaviorProfile,
    SecurityAlert,
    SecurityDetectedPattern,
    PatternLoginAttempt,
    RlsRule,
    RlsConditionGroup,
    RlsRuleCondition,
    RlsJoinPath,
    RlsJoinCondition,
    RlsScopeTemplate,
  ],
  migrations: ['src/database/migrations/*{.ts,.js}'],
  synchronize: false, // Disable synchronize as we're handling schema manually
  namingStrategy: new SnakeNamingStrategy(),
  migrationsRun: true, // Run migrations on app startup

  logging: ['query', 'error', 'schema'], // Added 'schema' logging
};

// Create and export TypeORM data source
const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
