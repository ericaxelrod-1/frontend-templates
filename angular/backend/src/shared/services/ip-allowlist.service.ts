import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Service to manage IP address allowlisting
 *
 * This service allows certain IP addresses to bypass security restrictions
 * such as rate limiting, CAPTCHA challenges, and IP blocking.
 */
@Injectable()
export class IPAllowlistService {
  private readonly logger = new Logger(IPAllowlistService.name);
  private allowlistedIPs: Set<string> = new Set();

  constructor(private readonly configService: ConfigService) {
    this.initializeAllowlist();
  }

  /**
   * Initialize the IP allowlist from environment variables
   */
  private initializeAllowlist(): void {
    // Always allowlist localhost addresses
    this.allowlistedIPs.add('127.0.0.1');
    this.allowlistedIPs.add('::1');

    // Add user-configured IPs from environment
    const configuredIPs = this.configService.get<string>('IP_ALLOWLIST', '');

    if (configuredIPs) {
      const ipArray = configuredIPs.split(',').map((ip) => ip.trim());
      ipArray.forEach((ip) => {
        if (ip && !this.allowlistedIPs.has(ip)) {
          this.allowlistedIPs.add(ip);
        }
      });
    }

    this.logger.log(
      `IP Allowlist initialized with ${this.allowlistedIPs.size} IP addresses`,
    );
  }

  /**
   * Check if an IP address is in the allowlist
   * @param ip The IP address to check
   * @returns true if the IP is allowlisted, false otherwise
   */
  isAllowlisted(ip: string): boolean {
    return this.allowlistedIPs.has(ip);
  }

  /**
   * Get the list of allowlisted IP addresses
   * @returns Array of allowlisted IP addresses
   */
  getAllowlistedIPs(): string[] {
    return Array.from(this.allowlistedIPs);
  }

  /**
   * Add an IP address to the allowlist at runtime
   * @param ip The IP address to add
   */
  addToAllowlist(ip: string): void {
    if (!this.allowlistedIPs.has(ip)) {
      this.allowlistedIPs.add(ip);
      this.logger.log(`Added IP ${ip} to allowlist`);
    }
  }

  /**
   * Remove an IP address from the allowlist at runtime
   * @param ip The IP address to remove
   */
  removeFromAllowlist(ip: string): void {
    // Don't allow removing localhost IPs
    if (ip === '127.0.0.1' || ip === '::1') {
      this.logger.warn(`Cannot remove localhost IP ${ip} from allowlist`);
      return;
    }

    if (this.allowlistedIPs.has(ip)) {
      this.allowlistedIPs.delete(ip);
      this.logger.log(`Removed IP ${ip} from allowlist`);
    }
  }
}
