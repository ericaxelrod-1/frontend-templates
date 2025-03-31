# IP Allowlist Feature Documentation

## Overview

The IP Allowlist feature enhances security while allowing trusted IP addresses to bypass security restrictions. This provides a better user experience for trusted sources (like internal networks, trusted partners, etc.) while maintaining robust security for unknown or potentially malicious sources.

## Key Components

### 1. IP Allowlist Service

**File:** `angular/backend/src/shared/services/ip-allowlist.service.ts`

The `IPAllowlistService` maintains a list of trusted IP addresses that are exempt from security restrictions. It provides:

- Default allowlisting for localhost (`127.0.0.1` and `::1`)
- Environment variable configuration via `IP_ALLOWLIST`
- Runtime methods to add or remove IPs from the allowlist
- Lookup functionality to check if an IP is allowlisted

```typescript
// Example usage
const ipAllowlistService = app.get(IPAllowlistService);
const isAllowlisted = ipAllowlistService.isAllowlisted('192.168.1.100');
```

### 2. IP Allowlist Middleware

**File:** `angular/backend/src/shared/middleware/ip-allowlist.middleware.ts`

The `IPAllowlistMiddleware` integrates with NestJS to:

- Extract the client IP from various headers (including `X-Forwarded-For`)
- Enrich the request object with client IP and allowlist status information
- Add a response header (`X-IP-Allowlisted`) for allowlisted IPs
- Operate globally across all routes

```typescript
// Request object is enhanced with
req.clientIp       // The extracted client IP address
req.isAllowlisted  // Boolean indicating allowlist status
```

### 3. IP Reputation Service Integration

**File:** `angular/backend/src/modules/auth/services/ip-reputation.service.ts`

The `IPReputationService` uses the allowlist to:

- Skip incrementing failed login attempts for allowlisted IPs
- Never block allowlisted IPs regardless of login behavior
- Never require CAPTCHA for allowlisted IPs
- Log detailed information about allowlist-based decisions

## Configuration

### Environment Variables

Configure the IP allowlist using the following environment variable:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `IP_ALLOWLIST` | Comma-separated list of allowlisted IP addresses | None | `192.168.1.100,10.0.0.1` |

### Allowlist Sources

IPs are allowlisted from the following sources:

1. **Default IPs** - Always included:
   - `127.0.0.1` - IPv4 localhost
   - `::1` - IPv6 localhost

2. **Environment Configuration** - From the `IP_ALLOWLIST` environment variable

3. **Runtime Additions** - Via `addToAllowlist()` method

### Debug Logging

The IP allowlist system supports detailed debug logging:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DEBUG_MODE` | Enable detailed debug logging | `false` | `true` |
| `LOG_TO_FILE` | Write logs to file | `false` | `true` |
| `LOG_DIR` | Directory for log files | `logs` | `logs/security` |

## Usage Examples

### Configuring Allowlisted IPs

Set up in your `.env` file:
```
IP_ALLOWLIST=192.168.1.100,10.0.0.1,203.0.113.42
DEBUG_MODE=true
LOG_TO_FILE=true
```

### Checking if an IP is Allowlisted

```typescript
import { IPAllowlistService } from 'src/shared/services/ip-allowlist.service';

@Injectable()
export class SomeService {
  constructor(private readonly ipAllowlistService: IPAllowlistService) {}
  
  someMethod(ipAddress: string) {
    if (this.ipAllowlistService.isAllowlisted(ipAddress)) {
      // Provide enhanced access or skip security checks
    } else {
      // Apply normal security rules
    }
  }
}
```

### Adding/Removing IPs at Runtime

```typescript
// Adding an IP to the allowlist
ipAllowlistService.addToAllowlist('203.0.113.42');

// Removing an IP from the allowlist
ipAllowlistService.removeFromAllowlist('203.0.113.42');
```

### Accessing Allowlist Information in Controllers

```typescript
@Controller('api/users')
export class UsersController {
  @Get()
  findAll(@Req() request: Request) {
    const clientIp = request['clientIp'];
    const isAllowlisted = request['isAllowlisted'];
    
    // Use these values for custom logic
    // ...
  }
}
```

## Testing

### Test Scripts

Two test scripts are provided to verify the IP allowlist functionality:

1. **Basic Test** - Tests core functionality and service integration
   ```
   npm run test:ip-allowlist
   ```

2. **Detailed Test** - Tests middleware behavior with various IP scenarios
   ```
   npm run test:ip-allowlist:detailed
   ```

### Test Scenarios

The detailed test script tests multiple scenarios:

- Local IP (localhost - 127.0.0.1)
- Configured allowlist IP (from environment)
- Regular non-allowlisted IP
- IP behind proxy (via X-Forwarded-For header)
- Multiple IPs in X-Forwarded-For header
- Non-allowlisted IP in X-Forwarded-For header

## Security Considerations

### Best Practices

1. **Limit allowlisted IPs** - Only allowlist IPs that absolutely require bypassing security measures
2. **Regular reviews** - Periodically review the allowlist to remove IPs that no longer need special access
3. **Internal IPs only** - Prefer allowlisting internal network IPs rather than public IPs
4. **Documentation** - Keep a record of which IPs are allowlisted and why
5. **Monitoring** - Monitor allowlisted IPs for suspicious activity despite their trusted status

### Logging

All allowlist decisions are logged for security monitoring:

- When an IP is added or removed from the allowlist
- When an allowlisted IP bypasses security restrictions
- When the service initializes with the list of allowlisted IPs

## Extending the Feature

### Supporting Additional Proxy Headers

To support additional proxy headers for IP extraction, modify the `getClientIp` method in `IPAllowlistMiddleware`:

```typescript
private getClientIp(req: Request): string {
  // Add support for additional headers
  const cfConnectingIp = req.headers['cf-connecting-ip'] as string;
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }
  
  // Existing implementation
  const xForwardedFor = req.headers['x-forwarded-for'] as string;
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    return ips[0];
  }
  
  return req.ip || req.connection.remoteAddress || '0.0.0.0';
}
```

### Integration with External IP Reputation Services

You could enhance the IP allowlist with external reputation services:

```typescript
// Example integration with external service
@Injectable()
export class IPAllowlistService {
  // ...
  
  async checkExternalReputation(ip: string): Promise<boolean> {
    try {
      const response = await this.httpService.get(`https://reputation-api.example.com/${ip}`).toPromise();
      return response.data.reputation_score > 80; // Threshold for good reputation
    } catch (error) {
      this.logger.error(`Error checking external reputation for IP ${ip}: ${error.message}`);
      return false;
    }
  }
}
``` 