import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../modules/auth/auth.module';
import { UserModule } from '../modules/user/user.module';
import { User } from '../modules/users/entities/user.entity';
import { LoginAttempt } from '../modules/auth/entities/login-attempt.entity';
import { IPReputation } from '../modules/auth/entities/ip-reputation.entity';
import { Captcha } from '../modules/auth/entities/captcha.entity';
import { Role } from '../modules/users/entities/role.entity';
import { Group } from '../modules/permissions/entities/group.entity';
import { GroupPermission } from '../modules/permissions/entities/group-permission.entity';
import { UserPermission } from '../modules/permissions/entities/user-permission.entity';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Action } from '../modules/permissions/entities/action.entity';
import { Resource } from '../modules/permissions/entities/resource.entity';
import { UiComponent } from '../modules/permissions/entities/ui-component.entity';
import { FrontendRoute } from '../modules/permissions/entities/frontend-route.entity';
import { ApiEndpoint } from '../modules/permissions/entities/api-endpoint.entity';
import { RolePermission } from '../modules/roles/entities/role-permission.entity';
import { RateLimitCounter } from '../modules/auth/entities/rate-limit-counter.entity';
import { UserBehaviorProfile } from '../modules/auth/entities/user-behavior-profile.entity';
import { SecurityAlert } from '../modules/auth/entities/security-alert.entity';
import { SecurityDetectedPattern } from '../modules/auth/entities/security-detected-pattern.entity';
import { PatternLoginAttempt } from '../modules/auth/entities/pattern-login-attempt.entity';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Add test-specific environment variables
      load: [
        () => ({
          JWT_SECRET: 'test-secret',
          JWT_EXPIRATION: '1h',
        }),
      ],
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: ':memory:',
      entities: [
        User,
        LoginAttempt,
        IPReputation,
        Captcha,
        Role,
        Group,
        GroupPermission,
        UserPermission,
        Permission,
        Action,
        Resource,
        UiComponent,
        FrontendRoute,
        ApiEndpoint,
        RolePermission,
        RateLimitCounter,
        UserBehaviorProfile,
        SecurityAlert,
        SecurityDetectedPattern,
        PatternLoginAttempt,
      ],
      synchronize: true,
      logging: false,
    }),
    ScheduleModule.forRoot(),
    SharedModule,
    AuthModule,
    UserModule,
  ],
})
export class TestModule {}
