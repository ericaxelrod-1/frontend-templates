import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { IPAllowlistService } from '../services/ip-allowlist.service';

@Injectable()
export class IPAllowlistMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IPAllowlistMiddleware.name);

  constructor(private readonly ipAllowlistService: IPAllowlistService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const ip = this.getClientIp(req);

    // Add the client IP to request for use in controllers/services
    req['clientIp'] = ip;

    // Add allowlist status to request for use in rate limiters, guards, etc.
    const isAllowlisted = this.ipAllowlistService.isAllowlisted(ip);
    req['isAllowlisted'] = isAllowlisted;

    if (isAllowlisted) {
      // Add header to responses for allowlisted IPs to help with debugging
      res.setHeader('X-IP-Allowlisted', 'true');
    }

    next();
  }

  /**
   * Extract the client IP address from the request
   * Handles various proxy scenarios and X-Forwarded-For headers
   */
  private getClientIp(req: Request): string {
    // If using a proxy like Nginx or CloudFlare, use X-Forwarded-For
    const xForwardedFor = req.headers['x-forwarded-for'] as string;
    if (xForwardedFor) {
      // X-Forwarded-For can be a comma-separated list; the client IP is the first one
      const ips = xForwardedFor.split(',').map((ip) => ip.trim());
      return ips[0];
    }

    // If no X-Forwarded-For, use the direct connection IP
    return req.ip || req.connection.remoteAddress || '0.0.0.0';
  }
}
