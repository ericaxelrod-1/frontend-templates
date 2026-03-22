import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './services/permissions.service';
import { PermissionCheckerService } from './services/permission-checker.service';
import { RlsValidationService } from './services/rls-validation.service';
import { PermissionsController } from './controllers/permissions.controller';
import { ResourcesController } from './controllers/resources.controller';
import { ActionsController } from './controllers/actions.controller';
import { RlsRulesController } from './controllers/rls-rules.controller';
import { RlsJoinPathsController } from './controllers/rls-join-paths.controller';
import { RlsScopeTemplatesController } from './controllers/rls-scope-templates.controller';
import { PermissionInspectorController } from './controllers/permission-inspector.controller';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UiComponent } from './entities/ui-component.entity';
import { FrontendRoute } from './entities/frontend-route.entity';
import { ApiEndpoint } from './entities/api-endpoint.entity';
import { Resource } from './entities/resource.entity';
import { Action } from './entities/action.entity';
import { UsersModule } from '../users/users.module';
import { ScannersModule } from './scanners/scanners.module';
import { PermissionsSharedModule } from './shared/permissions-shared.module';
import { CacheModule } from '../cache/cache.module';
import { PERMISSION_CHECKER } from './shared/permissions-shared.module';
import { GroupPermission } from './entities/group-permission.entity';
import { UserPermission } from './entities/user-permission.entity';
import { Group } from './entities/group.entity';
import { User } from '../users/entities/user.entity';
import { PermissionSeedsService } from '../../../src/database/seeds/permission-seeds.service';
import { RlsRule } from './entities/rls-rule.entity';
import { RlsJoinPath } from './entities/rls-join-path.entity';
import { RlsJoinCondition } from './entities/rls-join-condition.entity';
import { RlsScopeTemplate } from './entities/rls-scope-template.entity';
import { RlsContextGuard } from './guards/rls-context.guard';
import { RlsService } from '@our-org/nestjs-typeorm-rls';
import { RlsConditionGroup } from './entities/rls-condition-group.entity';
import { RlsRuleCondition } from './entities/rls-rule-condition.entity';
import { ScopeCompilerService } from './services/scope-compiler.service';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      Role,
      RolePermission,
      UiComponent,
      FrontendRoute,
      ApiEndpoint,
      Resource,
      Action,
      GroupPermission,
      UserPermission,
      Group,
      User,
      RlsRule,
      RlsConditionGroup,
      RlsRuleCondition,
      RlsJoinPath,
      RlsJoinCondition,
      RlsScopeTemplate,
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => ScannersModule),
    forwardRef(() => PermissionsSharedModule),
    forwardRef(() => CacheModule),
    RolesModule,
  ],
  controllers: [
    PermissionsController,
    ResourcesController,
    ActionsController,
    RlsRulesController,
    RlsJoinPathsController,
    RlsScopeTemplatesController,
    PermissionInspectorController,
  ],
  providers: [
    PermissionsService,
    {
      provide: PermissionCheckerService,
      useClass: PermissionCheckerService,
    },
    RlsValidationService,
    ScopeCompilerService,
    PermissionSeedsService,
    RlsContextGuard,
    RlsService,
  ],
  exports: [
    PermissionsService,
    PermissionCheckerService,
    RlsValidationService,
    ScopeCompilerService,
    TypeOrmModule,
    PermissionSeedsService,
    RlsContextGuard,
    RlsService,
  ],
})
export class PermissionsModule {}
