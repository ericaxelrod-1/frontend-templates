import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';
import { GroupsController } from './groups.controller';
import { RolesService } from './roles.service';
import { GroupsService } from './groups.service';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Group } from '../permissions/entities/group.entity';
import { UserGroup } from './entities/user-group.entity';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PermissionsSharedModule } from '../permissions/shared/permissions-shared.module';
import { PasswordValidationService } from '../auth/password-validation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, Group, UserGroup]),
    forwardRef(() => AuthModule),
    forwardRef(() => PermissionsModule),
    PermissionsSharedModule,
  ],
  controllers: [UsersController, RolesController, GroupsController],
  providers: [UsersService, RolesService, GroupsService, PasswordValidationService],
  exports: [UsersService, RolesService, GroupsService, TypeOrmModule],
})
export class UsersModule {}
