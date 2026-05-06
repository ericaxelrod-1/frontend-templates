import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscoveryModule } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { PrivacyAuditService } from './privacy-audit.service';
import { PrivacyRegistryService } from './privacy-registry.service';
import { PrivacyHousekeepingService } from './privacy-housekeeping.service';
import { PrivacyCleanupService } from './privacy-cleanup.service';
import { PrivacyTicketController } from './privacy-ticket.controller';
import { PrivacyPublicController } from './privacy-public.controller';
import { PrivacyTicketService } from './privacy-ticket.service';
import { PrivacyJurisdictionService } from './privacy-jurisdiction.service';
import { PrivacyMagicLinkService } from './privacy-magic-link.service';
import { User } from '../users/entities/user.entity';
import { LoginAttempt } from '../auth/entities/login-attempt.entity';
import { UserBehaviorProfile } from '../auth/entities/user-behavior-profile.entity';
import { SecurityAlert } from '../auth/entities/security-alert.entity';
import { PrivacyTicket } from './entities/privacy-ticket.entity';
import { PrivacyJob } from './entities/privacy-job.entity';
import { PrivacyAuditLog } from './entities/privacy-audit-log.entity';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      LoginAttempt,
      UserBehaviorProfile,
      SecurityAlert,
      PrivacyTicket,
      PrivacyJob,
      PrivacyAuditLog,
    ]),
    DiscoveryModule,
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
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
    NotificationsModule,
  ],
  controllers: [PrivacyController, PrivacyTicketController, PrivacyPublicController],
  providers: [
    PrivacyService,
    PrivacyAuditService,
    PrivacyTicketService,
    PrivacyRegistryService,
    PrivacyHousekeepingService,
    PrivacyCleanupService,
    PrivacyJurisdictionService,
    PrivacyMagicLinkService,
  ],
  exports: [
    PrivacyService,
    PrivacyAuditService,
    PrivacyTicketService,
    PrivacyRegistryService,
    PrivacyHousekeepingService,
    PrivacyCleanupService,
    PrivacyJurisdictionService,
    PrivacyMagicLinkService,
  ],
})
export class PrivacyModule {}
