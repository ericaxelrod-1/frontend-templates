import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { IPReputation } from '../entities/ip-reputation.entity';
import { IPAllowlistService } from '../../../shared/services/ip-allowlist.service';

@Injectable()
export class IPReputationService {
  private readonly logger = new Logger(IPReputationService.name);

  constructor(
    @InjectRepository(IPReputation)
    private readonly ipReputationRepository: Repository<IPReputation>,
    private readonly ipAllowlistService: IPAllowlistService,
  ) {
    this.logger.log('IP Reputation Service initialized');

    // Log allowlisted IPs at startup for easier debugging
    const allowlistedIPs = this.ipAllowlistService.getAllowlistedIPs();
    this.logger.log(
      `Initialized with ${allowlistedIPs.length} allowlisted IPs`,
    );
    this.logger.debug(`Allowlisted IPs: ${allowlistedIPs.join(', ')}`);
  }

  async getOrCreate(ipAddress: string): Promise<IPReputation> {
    let reputation = await this.ipReputationRepository.findOne({
      where: { ipAddress },
    });

    if (!reputation) {
      this.logger.debug(
        `Creating new IP reputation record for IP: ${ipAddress}`,
      );
      reputation = this.ipReputationRepository.create({
        ipAddress,
        failedLoginAttempts: 0,
        isManuallyBlocked: false,
      });
      await this.ipReputationRepository.save(reputation);
    }

    return reputation;
  }

  async incrementFailedAttempts(ipAddress: string): Promise<IPReputation> {
    // Skip incrementing for allowlisted IPs
    if (this.ipAllowlistService.isAllowlisted(ipAddress)) {
      this.logger.debug(
        `Not incrementing failed attempts for allowlisted IP: ${ipAddress}`,
      );
      return this.getOrCreate(ipAddress);
    }

    const reputation = await this.getOrCreate(ipAddress);
    reputation.failedLoginAttempts += 1;

    this.logger.debug(
      `Incremented failed attempts for IP ${ipAddress} to ${reputation.failedLoginAttempts}`,
    );

    if (reputation.failedLoginAttempts >= 5) {
      reputation.isManuallyBlocked = true;
      reputation.blockedUntilAuto = new Date(Date.now() + 30 * 60 * 1000); // Block for 30 minutes
      this.logger.warn(
        `IP ${ipAddress} has been blocked until ${reputation.blockedUntilAuto}`,
      );
    }

    return this.ipReputationRepository.save(reputation);
  }

  async isBlocked(ipAddress: string): Promise<boolean> {
    // Allowlisted IPs are never blocked
    if (this.ipAllowlistService.isAllowlisted(ipAddress)) {
      this.logger.debug(`IP ${ipAddress} is allowlisted and cannot be blocked`);
      return false;
    }

    const reputation = await this.ipReputationRepository.findOne({
      where: { ipAddress },
    });

    if (!reputation) {
      return false;
    }

    if (reputation.isManuallyBlocked && reputation.blockedUntilAuto) {
      if (reputation.blockedUntilAuto > new Date()) {
        this.logger.debug(
          `IP ${ipAddress} is currently blocked until ${reputation.blockedUntilAuto}`,
        );
        return true;
      }
      // Unblock if block duration has expired
      reputation.isManuallyBlocked = false;
      reputation.blockedUntilAuto = null;
      await this.ipReputationRepository.save(reputation);
      this.logger.debug(
        `Block for IP ${ipAddress} has expired and has been removed`,
      );
    }

    return false;
  }

  async requiresCaptcha(ipAddress: string): Promise<boolean> {
    // Allowlisted IPs never require CAPTCHA
    if (this.ipAllowlistService.isAllowlisted(ipAddress)) {
      this.logger.debug(
        `IP ${ipAddress} is allowlisted and does not require CAPTCHA`,
      );
      return false;
    }

    const reputation = await this.getOrCreate(ipAddress);
    const requiresCaptcha = reputation.failedLoginAttempts >= 3;

    if (requiresCaptcha) {
      this.logger.debug(
        `CAPTCHA required for IP ${ipAddress} due to ${reputation.failedLoginAttempts} failed attempts`,
      );
    }

    return requiresCaptcha;
  }

  async cleanupExpiredBlocks(): Promise<void> {
    const now = new Date();
    const result = await this.ipReputationRepository.update(
      {
        isManuallyBlocked: true,
        blockedUntilAuto: LessThan(now),
      },
      {
        isManuallyBlocked: false,
        blockedUntilAuto: null,
      },
    );

    if (result.affected > 0) {
      this.logger.log(`Cleaned up ${result.affected} expired IP blocks`);
    }
  }

  async reset(ipAddress: string): Promise<void> {
    const result = await this.ipReputationRepository.update(
      { ipAddress },
      {
        failedLoginAttempts: 0,
        isManuallyBlocked: false,
        blockedUntilAuto: null,
        captchaChallengeCount: 0,
      },
    );

    if (result.affected > 0) {
      this.logger.log(`Reset IP reputation for ${ipAddress}`);
    }
  }

  /**
   * Get statistics about login attempts for monitoring
   * @returns Statistics about blocked IPs and CAPTCHA-required IPs
   */
  async getStats(): Promise<{ blockedCount: number; captchaCount: number }> {
    const now = new Date();

    // Count blocked IPs
    const blockedCount = await this.ipReputationRepository.count({
      where: {
        isManuallyBlocked: true,
        blockedUntilAuto: LessThan(now),
      },
    });

    // Count IPs that require CAPTCHA but are not blocked
    // This requires a more complex query with TypeORM
    const captchaCount = await this.ipReputationRepository
      .createQueryBuilder('ip')
      .where('ip.failed_login_attempts >= :captchaThreshold', { captchaThreshold: 3 })
      .andWhere('ip.failed_login_attempts < :blockThreshold', { blockThreshold: 5 })
      .andWhere('ip.is_manually_blocked = :isBlocked', { isBlocked: false })
      .getCount();

    return { blockedCount, captchaCount };
  }
}
