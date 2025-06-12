import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PermissionSeedService } from './permission-seed.service';
import { RoleSeedService } from './role-seed.service';
import { Resource } from '../../modules/permissions/entities/resource.entity';
import { Action } from '../../modules/permissions/entities/action.entity';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { RolePermission } from '../../modules/permissions/entities/role-permission.entity';
import { GroupPermission } from '../../modules/permissions/entities/group-permission.entity';
import { UserPermission } from '../../modules/permissions/entities/user-permission.entity';
import { Role } from '../../modules/users/entities/role.entity';
import { Group } from '../../modules/users/entities/group.entity';
import { User } from '../../modules/users/entities/user.entity';
import { UserGroup } from '../../modules/users/entities/user-group.entity';
import { FrontendRoute } from '../../modules/permissions/entities/frontend-route.entity';
import { ApiEndpoint } from '../../modules/permissions/entities/api-endpoint.entity';
import { UiComponent } from '../../modules/permissions/entities/ui-component.entity';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DATABASE_FILE || 'db.sqlite',
      entities: [
        Resource,
        Action,
        Permission,
        RolePermission,
        GroupPermission,
        UserPermission,
        Role,
        Group,
        User,
        UserGroup,
        FrontendRoute,
        ApiEndpoint,
        UiComponent,
      ],
      synchronize: true,
      logging: true,
    }),
    TypeOrmModule.forFeature([
      Resource,
      Action,
      Permission,
      RolePermission,
      GroupPermission,
      UserPermission,
      Role,
      Group,
      User,
      UserGroup,
      FrontendRoute,
      ApiEndpoint,
      UiComponent,
    ]),
  ],
  providers: [PermissionSeedService, RoleSeedService],
  exports: [PermissionSeedService],
})
export class SeedModule {
  constructor(
    private readonly roleSeedService: RoleSeedService,
    private readonly permissionSeedService: PermissionSeedService,
  ) {}

  async onModuleInit() {
    try {
      // First seed roles, then permissions
      await this.roleSeedService.seed();
      await this.permissionSeedService.seed();
      console.log('Seed completed successfully');
    } catch (error) {
      console.error('Seed failed:', error);
    } finally {
      process.exit(0);
    }
  }
}
