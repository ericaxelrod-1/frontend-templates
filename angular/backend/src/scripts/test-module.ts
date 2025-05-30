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
      entities: [User, LoginAttempt, IPReputation, Captcha],
      synchronize: true,
      logging: false,
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
  ],
})
export class TestModule {}
