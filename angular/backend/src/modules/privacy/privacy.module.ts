import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { PrivacyTicketController } from './privacy-ticket.controller';
import { PrivacyTicketService } from './privacy-ticket.service';
import { User } from '../users/entities/user.entity';
import { LoginAttempt } from '../auth/entities/login-attempt.entity';
import { UserBehaviorProfile } from '../auth/entities/user-behavior-profile.entity';
import { SecurityAlert } from '../auth/entities/security-alert.entity';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      LoginAttempt,
      UserBehaviorProfile,
      SecurityAlert,
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [PrivacyController, PrivacyTicketController],
  providers: [PrivacyService, PrivacyTicketService],
  exports: [PrivacyService, PrivacyTicketService],
})
export class PrivacyModule {}
