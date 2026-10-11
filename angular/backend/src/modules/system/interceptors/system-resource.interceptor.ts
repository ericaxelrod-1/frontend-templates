import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { SystemHealthService } from '../services/system-health.service';
import { IS_HEAVY_ROUTE_KEY } from '../decorators/heavy-route.decorator';

@Injectable()
export class SystemResourceInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private systemHealthService: SystemHealthService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const isHeavyRoute = this.reflector.getAllAndOverride<boolean>(IS_HEAVY_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isHeavyRoute) {
      if (this.systemHealthService.isPanic()) {
        throw new ServiceUnavailableException(
          'System is in PANIC mode due to critical disk space (>98%). All heavy operations are halted.',
        );
      }

      if (this.systemHealthService.isResourceCritical()) {
        throw new ServiceUnavailableException(
          'System disk space is critical (>95%). Heavy operations are temporarily disabled.',
        );
      }
    }

    return next.handle();
  }
}
