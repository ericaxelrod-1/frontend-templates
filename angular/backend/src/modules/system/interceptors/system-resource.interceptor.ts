import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { SystemHealthService } from '../services/system-health.service';
import { IS_HEAVY_ROUTE_KEY } from '../decorators/heavy-route.decorator';
import {
  SentinelConfigService,
  SENTINEL_GUARD_ENV_VAR,
} from '../config/sentinel.config';

/** Methods that cannot make the disk any fuller. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The Sentinel's enforcement side (FR-015).
 *
 * Two tiers, both keyed on the *measured* status:
 *   CRITICAL (>= criticalPercent) - `@HeavyRoute()` handlers are refused.
 *   PANIC    (>= panicPercent)    - every write is refused, and heavy routes too.
 *
 * DISABLE_SENTINEL_GUARD is read here and nowhere else. Bypassing means
 * "the gate stops blocking", not "the Sentinel stops measuring": the health
 * snapshot keeps reporting the real tier, so an operator in override mode still
 * sees the disk at 99% and knows the override is why writes are getting through.
 */
@Injectable()
export class SystemResourceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SystemResourceInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly systemHealthService: SystemHealthService,
    private readonly sentinelConfig: SentinelConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isHeavyRoute = this.reflector.getAllAndOverride<boolean>(
      IS_HEAVY_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; url?: string }>();
    const method = (request?.method ?? 'GET').toUpperCase();
    const url = request?.url ?? 'unknown';

    const isPanic = this.systemHealthService.isPanic();
    const blocksWrites = isPanic && !READ_ONLY_METHODS.has(method);
    const blocksHeavyRoute =
      isHeavyRoute &&
      (isPanic || this.systemHealthService.isResourceCritical());

    if (!blocksWrites && !blocksHeavyRoute) {
      return next.handle();
    }

    const { criticalPercent, panicPercent } = this.sentinelConfig.thresholds;
    const tier = isPanic ? 'PANIC' : 'CRITICAL';
    const threshold = isPanic ? panicPercent : criticalPercent;

    if (this.sentinelConfig.guardDisabled) {
      // Never a silent pass. Every bypassed request leaves a warning naming the
      // flag, the tier that was overridden and what was let through.
      this.logger.warn(
        `${SENTINEL_GUARD_ENV_VAR} is set - bypassing Sentinel ${tier} ` +
          `(>= ${threshold}%) for ${blocksWrites ? 'write request' : 'heavy route'} ` +
          `${method} ${url} (handler: ${context.getHandler().name}).`,
      );
      return next.handle();
    }

    if (blocksWrites) {
      throw new ServiceUnavailableException(
        `System is in PANIC mode (disk >= ${threshold}%). All writes are halted ` +
          'to protect the filesystem.',
      );
    }

    throw new ServiceUnavailableException(
      `System disk space is critical (>= ${threshold}%). Heavy operations are ` +
        'temporarily disabled.',
    );
  }
}
