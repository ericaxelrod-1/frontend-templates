# Country and Region Blocking Implementation Plan

## Purpose

Block users from jurisdictions where the application cannot legally operate or lacks required compliance infrastructure.

## Primary Use Case: California Age Verification (AB 1043)

**Law**: California Digital Age Assurance Act (AB 1043)
**Effective**: January 1, 2027

**Our Compliance Approach**: BLOCK CALIFORNIA USERS
- This application will NOT comply with AB 1043 age verification requirements
- This application will NOT receive or respect OS age bracket signals
- All California users will be blocked via geo-blocking

**Rationale**: Age verification systems require significant infrastructure. For a boilerplate template, blocking is the simplest and lowest-risk compliance approach.

## Other Use Cases

| Jurisdiction | Reason | Compliance Approach |
|--------------|--------|-------------------|
| California (US-CA) | AB 1043 (2027) | Geo-block until legal review |
| EU (future) | GDPR | Geo-block or implement full compliance |
| Australia (future) | Privacy Act | Geo-block or implement full compliance |

## Free Tools Available

| Tool | Package | Database | License | Updates |
|------|---------|----------|---------|---------|
| geoip-lite | geoip-lite | MaxMind GeoLite2 | MIT | Monthly |

**Why geoip-lite:**
- Already used in codebase (`pattern-detection.service.ts` uses `geoip-lite`)
- Lightweight (country + region data)
- MIT license (no commercial restrictions)
- Supports IPv4 and IPv6
- Free to use

## Configuration

### Environment Variables

```bash
# Enable/disable geo blocking
GEO_BLOCK_ENABLED=false

# Block entire countries (ISO 3166-1 alpha-2 codes, comma-separated)
GEO_BLOCK_COUNTRIES=US,DE,FR

# Block specific regions (COUNTRY-REGION format, comma-separated)
# Format: COUNTRYCODE-REGIONCODE
# Examples:
#   California (USA): US-CA
#   Bavaria (Germany): DE-BY
#   New South Wales (Australia): AU-NSW
GEO_BLOCK_REGIONS=US-CA
```

### Simple Configuration Examples

```bash
# Block California only (AB 1043 compliance)
GEO_BLOCK_ENABLED=true
GEO_BLOCK_REGIONS=US-CA

# Block California and EU countries
GEO_BLOCK_ENABLED=true
GEO_BLOCK_COUNTRIES=DE,FR,IT,ES,NL
GEO_BLOCK_REGIONS=US-CA

# Block multiple regions
GEO_BLOCK_ENABLED=true
GEO_BLOCK_REGIONS=US-CA,US-NY,US-FL
```

### Region Codes Reference

| Region | Country | Code |
|--------|---------|------|
| California | USA | US-CA |
| New York | USA | US-NY |
| Texas | USA | US-TX |
| Florida | USA | US-FL |
| Bavaria | Germany | DE-BY |
| Berlin | Germany | DE-BE |
| New South Wales | Australia | AU-NSW |
| Victoria | Australia | AU-VIC |

## Implementation

### Phase 1: Middleware

**File**: `backend/src/common/middleware/geo-block.middleware.ts`

```typescript
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
    this.enabled = this.configService.get<boolean>('geoBlocking.enabled', false);
    this.blockedCountries = this.parseCountries(
      this.configService.get<string>('geoBlocking.blockedCountries', '')
    );
    this.blockedRegions = this.parseRegions(
      this.configService.get<string>('geoBlocking.blockedRegions', '')
    );
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.enabled) {
      return next();
    }

    // Skip certain paths (health checks, API docs)
    if (this.shouldSkip(req.path)) {
      return next();
    }

    const ip = this.getClientIp(req);
    const geo = geoip.lookup(ip);

    if (!geo) {
      // Allow if we can't determine location
      return next();
    }

    // Check country-level blocking
    if (this.blockedCountries.has(geo.country)) {
      throw this.createBlockedResponse('country', geo.country);
    }

    // Check region-level blocking
    if (this.blockedRegions.length > 0 && geo.region) {
      const isBlocked = this.blockedRegions.some(
        (block) => block.country === geo.country && block.region === geo.region
      );
      if (isBlocked) {
        throw this.createBlockedResponse('region', `${geo.country}-${geo.region}`);
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
    const skipPaths = ['/health', '/api/health', '/api-docs', '/swagger'];
    return skipPaths.some((p) => path.startsWith(p));
  }

  private parseCountries(env: string): Set<string> {
    if (!env) return new Set();
    return new Set(
      env.split(',')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length === 2)
    );
  }

  private parseRegions(env: string): RegionBlock[] {
    if (!env) return [];
    return env
      .split(',')
      .map((block) => {
        const [country, region] = block.trim().split('-');
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
    code: string
  ): HttpException {
    return new HttpException(
      {
        statusCode: 403,
        error: 'Access Denied',
        message: 'This service is not available in your region.',
        code,
        type,
      },
      403
    );
  }
}
```

### Phase 2: Module Registration

**File**: `backend/src/common/common.module.ts`

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { GeoBlockMiddleware } from './middleware/geo-block.middleware';

@Module({})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GeoBlockMiddleware).forRoutes('*');
  }
}
```

### Phase 3: Configuration

**File**: `backend/src/config/configuration.ts`

```typescript
export default () => ({
  geoBlocking: {
    enabled: process.env.GEO_BLOCK_ENABLED === 'true',
    blockedCountries: process.env.GEO_BLOCK_COUNTRIES || '',
    blockedRegions: process.env.GEO_BLOCK_REGIONS || '',
  },
});
```

### Phase 4: Frontend - Access Denied Page

**Component**: `frontend/src/app/features/blocked/blocked.component.ts`

```typescript
@Component({
  selector: 'app-blocked',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule],
  templateUrl: './blocked.component.html',
  styleUrls: ['./blocked.component.scss'],
})
export class BlockedComponent {
  regionCode: string = '';
  regionName: string = '';

  private regionNames: Record<string, string> = {
    'US-CA': 'California',
    'US-NY': 'New York',
    'US': 'United States',
    DE: 'Germany',
    FR: 'France',
  };

  constructor(private route: ActivatedRoute) {
    this.route.queryParams.subscribe((params) => {
      this.regionCode = params['code'] || '';
      this.regionName = this.regionNames[this.regionCode] || this.regionCode;
    });
  }
}
```

**Template**: `frontend/src/app/features/blocked/blocked.component.html`

```html
<div class="blocked-container">
  <mat-card class="blocked-card">
    <mat-icon class="warning-icon">block</mat-icon>

    <h1>Access Denied</h1>

    <p class="message">
      We're sorry, but this service is not available in {{ regionName || 'your region' }}.
    </p>

    <div class="info-section">
      <h3>Why am I seeing this?</h3>
      <p>
        This service is not available in your region due to local regulations
        or legal compliance requirements.
      </p>
    </div>

    <div class="help-section">
      <p>
        If you believe you've received this message in error, please contact support.
      </p>
    </div>
  </mat-card>
</div>
```

**Route**: `frontend/src/app/app.routes.ts`

```typescript
export const routes: Routes = [
  // ... other routes
  {
    path: 'blocked',
    component: BlockedComponent,
  },
];
```

### Phase 5: HTTP Interceptor

**File**: `frontend/src/app/core/interceptors/geo-block.interceptor.ts`

```typescript
@Injectable()
export class GeoBlockInterceptor implements HttpInterceptor {
  constructor(private router: Router) {}

  intercept(
    req: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((err) => {
        if (err instanceof HttpErrorResponse && err.status === 403) {
          const error = err.error;
          if (error?.error === 'Access Denied') {
            this.router.navigate(['/blocked'], {
              queryParams: { code: error.code },
            });
            return of(err);
          }
        }
        return throwError(() => err);
      })
    );
  }
}
```

## Testing

### Unit Tests

**File**: `backend/src/common/middleware/geo-block.middleware.spec.ts`

```typescript
describe('GeoBlockMiddleware', () => {
  let middleware: GeoBlockMiddleware;
  let mockConfigService: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string, defaultValue: any) => {
        const config: Record<string, any> = {
          'geoBlocking.enabled': true,
          'geoBlocking.blockedCountries': 'US',
          'geoBlocking.blockedRegions': 'US-CA',
        };
        return config[key] ?? defaultValue;
      }),
    };
    middleware = new GeoBlockMiddleware(mockConfigService);
  });

  it('should block requests from blocked country', () => {
    const req = { path: '/', ip: '8.8.8.8', headers: {}, socket: { remoteAddress: '8.8.8.8' } } as any;
    const res = {};
    const next = jest.fn();

    // US IP should be blocked
    middleware.use(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow requests from non-blocked country', () => {
    const req = { path: '/', ip: '5.5.5.5', headers: {}, socket: { remoteAddress: '5.5.5.5' } } as any;
    const res = {};
    const next = jest.fn();

    // Non-US IP should pass
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should skip health check paths', () => {
    const req = { path: '/health', ip: '8.8.8.8', headers: {}, socket: { remoteAddress: '8.8.8.8' } } as any;
    const res = {};
    const next = jest.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

## Limitations

### VPN/Proxy Detection

**Not implemented.** Users can bypass IP-based blocking using VPNs or proxies.

- Geo-blocking is not foolproof
- Users determined to access the service can use VPNs
- For strict compliance, additional checks would be required

### Region Accuracy

**Region-level accuracy varies:**
- Country-level: >99% accurate
- Region-level: ~80-90% accurate (depends on IP range data)

For California AB 1043:
- Region blocking provides reasonable compliance
- Some false positives/negatives are acceptable for a boilerplate

## Privacy Policy Documentation

Add the following section to your privacy policy:

```markdown
## Regional Restrictions

This service may not be available in all jurisdictions due to local regulations.

If you are located in a restricted region, you will not be able to access this service.

For questions about regional availability, please contact us.
```

See `angular/docs/PRIVACY_COMPLIANCE.md` for complete privacy policy requirements.

## Estimated Effort

- Backend middleware: 1 day
- Frontend blocked page: 0.5 day
- HTTP interceptor: 0.25 day
- Testing: 0.5 day
- Documentation: 0.25 day
- **Total**: ~2.5 days

## Dependencies

- geoip-lite (already in project)
- NestJS middleware setup
- Angular routing and interceptors
