import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Group } from '../permissions/entities/group.entity';
import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PermissionsSharedModule } from '../permissions/shared/permissions-shared.module';
import { RolesModule } from '../roles/roles.module';
import { PasswordValidationService } from '../auth/password-validation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, Group]),
    forwardRef(() => AuthModule),
    forwardRef(() => PermissionsModule),
    forwardRef(() => RolesModule),
    PermissionsSharedModule,
  ],
  controllers: [UsersController, GroupsController],
  providers: [UsersService, GroupsService, PasswordValidationService],
  exports: [UsersService, GroupsService, TypeOrmModule],
})
export class UsersModule {}
