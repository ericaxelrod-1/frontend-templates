import { Injectable, NestMiddleware, HttpException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as geoip from 'geoip-lite';
import { ConfigService } from '@nestjs/config';

export interface RegionBlock {
  country: string;
  region: string;
}

@Injectable()
export class GeoBlockMiddleware implements NestMiddleware {
  private enabled: boolean;
  private blockedCountries: Set<string>;
  private blockedRegions: RegionBlock[];

  constructor(private configService: ConfigService) {
    this.enabled = this.configService.get<boolean>(
      'geoBlocking.enabled',
      false,
    );
    this.blockedCountries = this.parseCountries(
      this.configService.get<string>('geoBlocking.blockedCountries', ''),
    );
    this.blockedRegions = this.parseRegions(
      this.configService.get<string>('geoBlocking.blockedRegions', ''),
    );
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.enabled) {
      return next();
    }

    if (this.shouldSkip(req.path)) {
      return next();
    }

    const ip = this.getClientIp(req);
    const geo = geoip.lookup(ip);

    if (!geo) {
      return next();
    }

    if (this.blockedCountries.has(geo.country)) {
      throw this.createBlockedResponse('country', geo.country);
    }

    if (this.blockedRegions.length > 0 && geo.region) {
      const isBlocked = this.blockedRegions.some(
        (block) => block.country === geo.country && block.region === geo.region,
      );
      if (isBlocked) {
        throw this.createBlockedResponse(
          'region',
          `${geo.country}-${geo.region}`,
        );
      }
    }

    next();
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || '127.0.0.1';
  }

  private shouldSkip(path: string): boolean {
    const skipPaths = [
      '/health',
      '/api/health',
      '/api-docs',
      '/swagger',
      '/auth/login',
      '/auth/register',
    ];
    return skipPaths.some((p) => path.startsWith(p));
  }

  private parseCountries(env: string): Set<string> {
    if (!env) return new Set();
    return new Set(
      env
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length === 2),
    );
  }

  private parseRegions(env: string): RegionBlock[] {
    if (!env) return [];
    return env
      .split(',')
      .map((block) => {
        const parts = block.trim().split('-');
        if (parts.length !== 2) return null;
        const [country, region] = parts;
        if (!country || !region) return null;
        return {
          country: country.toUpperCase(),
          region: region.toUpperCase(),
        };
      })
      .filter((r): r is RegionBlock => r !== null);
  }

  private createBlockedResponse(
    type: 'country' | 'region',
    code: string,
  ): HttpException {
    return new HttpException(
      {
        statusCode: 403,
        error: 'Access Denied',
        message: 'This service is not available in your region.',
        code,
        type,
      },
      403,
    );
  }
}
