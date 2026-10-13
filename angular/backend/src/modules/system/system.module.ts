import { Module, Global, forwardRef } from '@nestjs/common';
import { SystemHealthService } from './services/system-health.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SystemResourceInterceptor } from './interceptors/system-resource.interceptor';
import { SystemHealthController } from '../system-health/system-health.controller';
import { PrivacyModule } from '../privacy/privacy.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SentinelConfigService } from './config/sentinel.config';

@Global()
@Module({
  imports: [
    forwardRef(() => PrivacyModule),
    forwardRef(() => PermissionsModule),
  ],
  controllers: [SystemHealthController],
  providers: [
    SentinelConfigService,
    SystemHealthService,
    {
      provide: APP_INTERCEPTOR,
      useClass: SystemResourceInterceptor,
    },
  ],
  exports: [SentinelConfigService, SystemHealthService],
})
export class SystemModule {}
