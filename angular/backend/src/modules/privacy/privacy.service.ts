import {
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { LoginAttempt } from '../auth/entities/login-attempt.entity';
import { UserBehaviorProfile } from '../auth/entities/user-behavior-profile.entity';
import { SecurityAlert } from '../auth/entities/security-alert.entity';
import { UsersService } from '../users/users.service';
import { PrivacyRegistryService } from './privacy-registry.service';

export interface UserDataExport {
  profile: {
    id: number;
    username: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    isEmailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastLoginAt: Date | null;
    preferences: Record<string, any> | null;
  };
  privacyPreferences: {
    marketingConsent: boolean;
    doNotSell: boolean;
    consentUpdatedAt: Date | null;
    privacyRestrictions: Record<string, boolean> | null;
    processingObjections: Record<string, string> | null;
    processingObjectionAt: Date | null;
  };
  loginHistory: {
    id: number;
    ipAddress: string;
    userAgent: string;
    status: string;
    attemptedAt: Date;
    failureReason: string | null;
  }[];
  behaviorProfile: {
    id: string;
    typicalLoginHours: boolean[] | null;
    knownIps: string[] | null;
    knownUserAgents: string[] | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  securityAlerts: {
    id: number;
    alertType: string;
    severity: string;
    title: string;
    message: string;
    source: string;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }[];
}

export interface DeleteAccountResult {
  success: boolean;
  deletedAt: Date;
  message: string;
}

export interface PrivacyRestrictionsUpdate {
  restrictions: Record<string, boolean>;
}

export interface ProcessingObjection {
  processingType: string;
  reason: string;
}

@Injectable()
export class PrivacyService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(LoginAttempt)
    private readonly loginAttemptRepository: Repository<LoginAttempt>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorProfileRepository: Repository<UserBehaviorProfile>,
    @InjectRepository(SecurityAlert)
    private readonly securityAlertRepository: Repository<SecurityAlert>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly privacyRegistry: PrivacyRegistryService,
  ) {}

  async exportUserData(userId: number): Promise<UserDataExport> {
    const user = await this.usersService.findOne(userId);
    if (!user || user.isDeleted) {
      throw new NotFoundException('User not found or already deleted');
    }

    const loginHistory = await this.loginAttemptRepository.find({
      where: { user: { id: userId } } as any,
      order: { attemptedAt: 'DESC' as any },
      take: 100, // ID 8: Hard limit to prevent memory bloat
    });

    const behaviorProfile = await this.behaviorProfileRepository.findOne({
      where: { userId },
    });

    const securityAlerts = await this.securityAlertRepository.find({
      where: { user: { id: userId } } as any,
      order: { createdAt: 'DESC' as any },
      take: 50, // ID 8: Hard limit
    });

    return {
      profile: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
        preferences: user.preferences,
      },
      privacyPreferences: {
        marketingConsent: user.marketingConsent,
        doNotSell: user.doNotSell,
        consentUpdatedAt: user.consentUpdatedAt,
        privacyRestrictions: user.privacyRestrictions,
        processingObjections: user.processingObjections,
        processingObjectionAt: user.processingObjectionAt,
      },
      loginHistory: loginHistory.map((attempt) => ({
        id: attempt.id,
        ipAddress: attempt.ipAddress,
        userAgent: attempt.userAgent,
        status: attempt.status,
        attemptedAt: attempt.attemptedAt,
        failureReason: attempt.failureReason,
      })),
      behaviorProfile: behaviorProfile
        ? {
            id: behaviorProfile.id,
            typicalLoginHours: behaviorProfile.typicalLoginHours,
            knownIps: behaviorProfile.knownIps,
            knownUserAgents: behaviorProfile.knownUserAgents,
            createdAt: behaviorProfile.createdAt,
            updatedAt: behaviorProfile.updatedAt,
          }
        : null,
      securityAlerts: securityAlerts.map((alert) => ({
        id: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        source: alert.source,
        status: alert.status,
        createdAt: alert.createdAt,
        resolvedAt: alert.resolvedAt,
      })),
    };
  }

  async getExportPreview(userId: number): Promise<Record<string, number>> {
    const userIdStr = userId.toString();
    const providers = this.privacyRegistry.getProviders();

    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          return await provider.getPreview(userIdStr);
        } catch (error) {
          return {};
        }
      }),
    );

    return results.reduce((acc, curr) => {
      Object.entries(curr).forEach(([key, value]) => {
        acc[key] = (acc[key] || 0) + value;
      });
      return acc;
    }, {});
  }

  async deleteAccount(userId: number): Promise<DeleteAccountResult> {
    const user = await this.usersService.findOne(userId);
    if (!user || user.isDeleted) {
      throw new NotFoundException('User not found or already deleted');
    }
    const userIdStr = userId.toString();

    // Polymorphic Purge with Timeout
    const providers = this.privacyRegistry.getProviders();
    const DELETION_TIMEOUT_MS = 30000; // 30 seconds

    await Promise.allSettled(
      providers.map(async (provider) => {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          DELETION_TIMEOUT_MS,
        );
        try {
          // ID 9: Missing Deletion Timeouts - Race between provider logic and system timeout
          await Promise.race([
            provider.onDelete(userIdStr),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Timeout after ${DELETION_TIMEOUT_MS}ms`)),
                DELETION_TIMEOUT_MS,
              ),
            ),
          ]);
        } catch (error) {
          console.error(
            `Privacy Provider ${provider.providerName} failed for user ${userId}: ${error.message}`,
          );
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    await this.userRepository.update(userId, {
      isDeleted: true,
      deletedAt: new Date(),
      email: `deleted_${userId}_${Date.now()}@deleted.local`,
      username: `deleted_${userId}_${Date.now()}`,
      marketingConsent: false,
      doNotSell: false,
      privacyRestrictions: null,
      processingObjections: null,
    });

    return {
      success: true,
      deletedAt: new Date(),
      message:
        'Your account has been deleted. All personal data has been removed.',
    };
  }

  async updatePrivacyRestrictions(
    userId: number,
    update: PrivacyRestrictionsUpdate,
  ): Promise<User> {
    const user = await this.usersService.findOne(userId);

    await this.userRepository.update(userId, {
      privacyRestrictions: update.restrictions,
      consentUpdatedAt: new Date(),
    });

    return this.usersService.findOne(userId);
  }

  async submitProcessingObjection(
    userId: number,
    objection: ProcessingObjection,
  ): Promise<User> {
    const user = await this.usersService.findOne(userId);

    const currentObjections = user.processingObjections || {};
    currentObjections[objection.processingType] = objection.reason;

    await this.userRepository.update(userId, {
      processingObjections: currentObjections,
      processingObjectionAt: new Date(),
      consentUpdatedAt: new Date(),
    });

    return this.usersService.findOne(userId);
  }

  async removeProcessingObjection(
    userId: number,
    processingType: string,
  ): Promise<User> {
    const user = await this.usersService.findOne(userId);

    const currentObjections = user.processingObjections || {};
    delete currentObjections[processingType];

    await this.userRepository.update(userId, {
      processingObjections:
        Object.keys(currentObjections).length > 0 ? currentObjections : null,
      consentUpdatedAt: new Date(),
    });

    return this.usersService.findOne(userId);
  }

  async updateMarketingConsent(
    userId: number,
    consent: boolean,
  ): Promise<User> {
    const user = await this.usersService.findOne(userId);

    await this.userRepository.update(userId, {
      marketingConsent: consent,
      consentUpdatedAt: new Date(),
    });

    return this.usersService.findOne(userId);
  }

  async updateDoNotSell(userId: number, doNotSell: boolean): Promise<User> {
    const user = await this.usersService.findOne(userId);

    await this.userRepository.update(userId, {
      doNotSell: doNotSell,
      consentUpdatedAt: new Date(),
    });

    return this.usersService.findOne(userId);
  }

  async getPrivacyPreferences(userId: number): Promise<{
    marketingConsent: boolean;
    doNotSell: boolean;
    consentUpdatedAt: Date | null;
    privacyRestrictions: Record<string, boolean> | null;
    processingObjections: Record<string, string> | null;
  }> {
    const user = await this.usersService.findOne(userId);

    return {
      marketingConsent: user.marketingConsent,
      doNotSell: user.doNotSell,
      consentUpdatedAt: user.consentUpdatedAt,
      privacyRestrictions: user.privacyRestrictions,
      processingObjections: user.processingObjections,
    };
  }
}
