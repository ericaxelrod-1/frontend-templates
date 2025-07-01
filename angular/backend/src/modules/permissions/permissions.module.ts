import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './services/permissions.service';
import { PermissionCheckerService } from './services/permission-checker.service';
import { PermissionsController } from './controllers/permissions.controller';
import { ResourcesController } from './controllers/resources.controller';
import { ActionsController } from './controllers/actions.controller';
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
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => ScannersModule),
    forwardRef(() => PermissionsSharedModule),
    forwardRef(() => CacheModule),
  ],
  controllers: [PermissionsController, ResourcesController, ActionsController],
  providers: [
    PermissionsService,
    {
      provide: PermissionCheckerService,
      useClass: PermissionCheckerService,
    },
    PermissionSeedsService,
  ],
  exports: [
    PermissionsService,
    PermissionCheckerService,
    TypeOrmModule,
    PermissionSeedsService,
  ],
})
export class PermissionsModule {}
