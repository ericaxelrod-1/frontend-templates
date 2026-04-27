import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscoveryModule } from '@nestjs/core';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { PrivacyRegistryService } from './privacy-registry.service';
import { PrivacyHousekeepingService } from './privacy-housekeeping.service';
import { PrivacyCleanupService } from './privacy-cleanup.service';
import { PrivacyTicketController } from './privacy-ticket.controller';
import { PrivacyTicketService } from './privacy-ticket.service';
import { User } from '../users/entities/user.entity';
import { LoginAttempt } from '../auth/entities/login-attempt.entity';
import { UserBehaviorProfile } from '../auth/entities/user-behavior-profile.entity';
import { SecurityAlert } from '../auth/entities/security-alert.entity';
import { PrivacyTicket } from './entities/privacy-ticket.entity';
import { PrivacyJob } from './entities/privacy-job.entity';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      LoginAttempt,
      UserBehaviorProfile,
      SecurityAlert,
      PrivacyTicket,
      PrivacyJob,
    ]),
    DiscoveryModule,
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [PrivacyController, PrivacyTicketController],
  providers: [
    PrivacyService,
    PrivacyTicketService,
    PrivacyRegistryService,
    PrivacyHousekeepingService,
    PrivacyCleanupService,
  ],
  exports: [
    PrivacyService,
    PrivacyTicketService,
    PrivacyRegistryService,
    PrivacyHousekeepingService,
    PrivacyCleanupService,
  ],
})
export class PrivacyModule {}
