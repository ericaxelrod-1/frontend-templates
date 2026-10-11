import { Module, Global, forwardRef } from '@nestjs/common';
import { SystemHealthService } from './services/system-health.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SystemResourceInterceptor } from './interceptors/system-resource.interceptor';
import { SystemHealthController } from '../system-health/system-health.controller';
import { PrivacyModule } from '../privacy/privacy.module';

@Global()
@Module({
  imports: [forwardRef(() => PrivacyModule)],
  controllers: [SystemHealthController],
  providers: [
    SystemHealthService,
    {
      provide: APP_INTERCEPTOR,
      useClass: SystemResourceInterceptor,
    },
  ],
  exports: [SystemHealthService],
})
export class SystemModule {}
