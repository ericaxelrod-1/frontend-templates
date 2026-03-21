import {
  Module,
  MiddlewareConsumer,
  NestModule,
  OnModuleInit,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsModule } from 'nestjs-cls';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { User } from './modules/users/entities/user.entity';
import { LoginAttempt } from './modules/auth/entities/login-attempt.entity';
import { IPReputation } from './modules/auth/entities/ip-reputation.entity';
import { Captcha } from './modules/auth/entities/captcha.entity';
import { SharedModule } from './shared/shared.module';
import { IPAllowlistMiddleware } from './shared/middleware/ip-allowlist.middleware';
import { LoggerModule } from './logger/logger.module';
import { CaptchaModule } from './modules/captcha/captcha.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import environmentConfig from './config/environment.config';
import databaseConfig from './config/database.config';
import { PermissionsService } from './modules/permissions/services/permissions.service';
import { Logger } from '@nestjs/common';
import { UsersSharedModule } from './modules/users/shared/users-shared.module';
import { PermissionsSharedModule } from './modules/permissions/shared/permissions-shared.module';
import { AuthSharedModule } from './modules/auth/shared/auth-shared.module';
import { RlsModule } from '@our-org/nestjs-typeorm-rls';
import { RlsRule } from './modules/permissions/entities/rls-rule.entity';
import { RlsJoinPath } from './modules/permissions/entities/rls-join-path.entity';
import { RlsJoinCondition } from './modules/permissions/entities/rls-join-condition.entity';
import { RlsScopeTemplate } from './modules/permissions/entities/rls-scope-template.entity';
import { DataSource } from 'typeorm';

declare global {
  // eslint-disable-next-line no-var
  var __RLS_NESTJS_DATASOURCE__: DataSource | undefined;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [environmentConfig, databaseConfig],
    }),
    ClsModule.forRoot({
      global: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.get('database'),
    }),
    ScheduleModule.forRoot(),
    LoggerModule,
    SharedModule,
    UsersSharedModule,
    PermissionsSharedModule,
    AuthSharedModule,
    RlsModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = configService.get('database');
        return {
          enabled: process.env.NODE_ENV !== 'test',
          exemptTables: ['rls_rules', 'rls_join_paths', 'rls_join_conditions', 'rls_scope_templates'],
          fallbackBehavior: 'deny' as const,
          dataSourceOptions: dbConfig as any,
        };
      },
    }),
    AuthModule,
    UsersModule,
    CaptchaModule,
    PermissionsModule,
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly permissionsService: PermissionsService,
  ) {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IPAllowlistMiddleware).forRoutes('*path');
  }

  async onModuleInit() {
    const environment = this.configService.get('NODE_ENV', 'development');

    if (environment === 'development') {
      this.logger.log(
        'Development environment detected, seeding default permissions...',
      );
      try {
        await this.permissionsService.seedDefaultPermissions();
        this.logger.log('Default permissions seeded successfully');
      } catch (error) {
        this.logger.error(
          `Error seeding default permissions: ${error.message}`,
          error.stack,
        );
      }
    }
  }
}
