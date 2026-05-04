import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrivacyAuditLog } from './entities/privacy-audit-log.entity';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class PrivacyAuditService {
  constructor(
    @InjectRepository(PrivacyAuditLog)
    private readonly auditRepository: Repository<PrivacyAuditLog>,
    private readonly configService: ConfigService,
  ) {}

  async logAction(
    ticketId: number,
    userId: number | null,
    action: string,
  ): Promise<void> {
    // ID 5: Multi-Key KID keyring logic
    const currentKid = this.configService.get<string>('PRIVACY_KID', 'v1');
    const pepper = this.configService.get<string>(
      `PRIVACY_PEPPER_${currentKid}`,
      this.configService.get<string>('PRIVACY_PEPPER', 'default-pepper'),
    );

    // Fix: Escape delimiters or use JSON to prevent parameter injection
    const safeAction = action.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    const dataToHash = `${ticketId}:${userId ?? 'null'}:${safeAction}`;
    const hmacHash = crypto
      .createHmac('sha256', pepper)
      .update(dataToHash)
      .digest('hex');

    const logEntry = this.auditRepository.create({
      ticketId,
      userId,
      action,
      hmacHash,
      kid: currentKid,
    });

    await this.auditRepository.save(logEntry);
  }
}
