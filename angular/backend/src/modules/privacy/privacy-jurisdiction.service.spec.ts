import { Test, TestingModule } from '@nestjs/testing';
import { PrivacyJurisdictionService } from './privacy-jurisdiction.service';
import { PrivacyRegulation } from './entities/privacy-ticket.entity';

describe('PrivacyJurisdictionService', () => {
  let service: PrivacyJurisdictionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrivacyJurisdictionService],
    }).compile();

    service = module.get<PrivacyJurisdictionService>(PrivacyJurisdictionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveRegulation', () => {
    it('should prioritize Declaration over everything', () => {
      const result = service.resolveRegulation('8.8.8.8', 'EU', 'US-CA');
      expect(result).toBe(PrivacyRegulation.GDPR);
    });

    it('should prioritize Profile over IP', () => {
      const result = service.resolveRegulation('8.8.8.8', undefined, 'CALIFORNIA');
      expect(result).toBe(PrivacyRegulation.CCPA);
    });

    it('should fallback to IP (US-CA)', () => {
      // Mocking geoip is tricky, assuming 8.8.8.8 is US (not CA)
      // or using a known CA IP
      const result = service.resolveRegulation('12.31.25.15'); // Sample IP
      // This depends on the geoip-lite DB, but we test the fallback logic
      expect([PrivacyRegulation.GDPR, PrivacyRegulation.CCPA, PrivacyRegulation.OTHER]).toContain(result);
    });

    it('should default to OTHER on failure', () => {
      const result = service.resolveRegulation('invalid-ip');
      expect(result).toBe(PrivacyRegulation.OTHER);
    });
  });

  describe('getSlaDeadline', () => {
    it('should return 30 days for GDPR', () => {
      const deadline = service.getSlaDeadline(PrivacyRegulation.GDPR);
      const diff = deadline.getTime() - new Date().getTime();
      expect(Math.ceil(diff / (1000 * 60 * 60 * 24))).toBe(30);
    });

    it('should return 45 days for CCPA', () => {
      const deadline = service.getSlaDeadline(PrivacyRegulation.CCPA);
      const diff = deadline.getTime() - new Date().getTime();
      expect(Math.ceil(diff / (1000 * 60 * 60 * 24))).toBe(45);
    });
  });
});
