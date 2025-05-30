import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';
import { PasswordValidationService } from './password-validation.service';
import { Role } from '../users/entities/role.entity';
import { LoginAttempt } from './entities/login-attempt.entity';
import { IPReputation } from './entities/ip-reputation.entity';
import { Captcha } from './entities/captcha.entity';
import { LoginAttemptService } from './services/login-attempt.service';
import { IPReputationService } from './services/ip-reputation.service';
import { CaptchaService } from './services/captcha.service';
import { PatternDetectionService } from './services/pattern-detection.service';
import { AlertService } from './services/alert.service';
import { CleanupTask } from './tasks/cleanup.task';
import { ScheduleModule } from '@nestjs/schedule';
import { LoginMonitoringController } from './controllers/login-monitoring.controller';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => PermissionsModule),
    PassportModule,
    TypeOrmModule.forFeature([Role, LoginAttempt, IPReputation, Captcha, User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'your-secret-key'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1d'),
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController, LoginMonitoringController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    PasswordValidationService,
    LoginAttemptService,
    IPReputationService,
    CaptchaService,
    PatternDetectionService,
    AlertService,
    CleanupTask,
  ],
  exports: [
    AuthService,
    PasswordValidationService,
    JwtStrategy,
    LoginAttemptService,
    IPReputationService,
    CaptchaService,
    PatternDetectionService,
    AlertService,
  ],
})
export class AuthModule {}
