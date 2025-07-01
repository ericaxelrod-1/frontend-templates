import { Module } from '@nestjs/common';
import { Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionCheckerService } from '../services/permission-checker.service';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { User } from '../../users/entities/user.entity';
import { UserPermission } from '../entities/user-permission.entity';
import { GroupPermission } from '../entities/group-permission.entity';
import { forwardRef } from '@nestjs/common';
import { PermissionsModule } from '../permissions.module';

/**
 * Token for the permission checker provider
 * This is used to inject the permission checker into other modules
 */
export const PERMISSION_CHECKER = 'PERMISSION_CHECKER';

/**
 * Shared module for Permission-related interfaces and DTOs
 * This module is used to break circular dependencies between modules
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      RolePermission,
      User,
      UserPermission,
      GroupPermission,
    ]),
    forwardRef(() => PermissionsModule),
  ],
  providers: [
    {
      provide: PERMISSION_CHECKER,
      useClass: PermissionCheckerService,
    },
  ],
  exports: [PERMISSION_CHECKER, TypeOrmModule],
})
export class PermissionsSharedModule {}
