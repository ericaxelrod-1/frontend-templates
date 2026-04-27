import { Injectable } from '@nestjs/common';
import { PrivacyRegulation } from './entities/privacy-ticket.entity';
import * as geoip from 'geoip-lite';

@Injectable()
export class PrivacyJurisdictionService {
  /**
   * Resolves the applicable privacy regulation based on user context.
   * Priority: Declaration > Profile Address (TODO) > IP-based Geo
   */
  resolveRegulation(ipAddress?: string, declaredRegion?: string): PrivacyRegulation {
    if (declaredRegion) {
      return this.mapRegionToRegulation(declaredRegion);
    }

    if (ipAddress) {
      const geo = geoip.lookup(ipAddress);
      if (geo) {
        if (this.isEURegion(geo.country)) {
          return PrivacyRegulation.GDPR;
        }
        if (geo.country === 'US' && geo.region === 'CA') {
          return PrivacyRegulation.CCPA;
        }
      }
    }

    // Default to most restrictive (GDPR) if unknown
    return PrivacyRegulation.GDPR;
  }

  private mapRegionToRegulation(region: string): PrivacyRegulation {
    const r = region.toUpperCase();
    if (['EU', 'EUROPE', 'FRANCE', 'GERMANY'].includes(r)) return PrivacyRegulation.GDPR;
    if (['CA', 'CALIFORNIA'].includes(r)) return PrivacyRegulation.CCPA;
    return PrivacyRegulation.OTHER;
  }

  private isEURegion(countryCode: string): boolean {
    const euCountries = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB' // GB is technically UK but often follows similar GDPR
    ];
    return euCountries.includes(countryCode);
  }

  getSlaDeadline(regulation: PrivacyRegulation): Date {
    const now = new Date();
    const days = this.getSlaDays(regulation);
    now.setDate(now.getDate() + days);
    return now;
  }

  private getSlaDays(regulation: PrivacyRegulation): number {
    switch (regulation) {
      case PrivacyRegulation.GDPR:
        return 30;
      case PrivacyRegulation.CCPA:
        return 45;
      default:
        return 30; // Global fallback
    }
  }
}
