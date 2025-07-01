import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { ComponentScannerService } from './component-scanner.service';
import { RouteScannerService } from './route-scanner.service';
import { EndpointScannerService } from './endpoint-scanner.service';
import { ManifestService } from './manifest.service';
import { Permission } from '../entities/permission.entity';
import { UiComponent } from '../entities/ui-component.entity';
import { FrontendRoute } from '../entities/frontend-route.entity';
import { ApiEndpoint } from '../entities/api-endpoint.entity';
import { CacheModule } from '../../cache/cache.module';

/**
 * Module that provides all scanner services for permission management
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      UiComponent,
      FrontendRoute,
      ApiEndpoint,
    ]),
    CacheModule,
    ConfigModule,
    DiscoveryModule,
  ],
  providers: [
    ComponentScannerService,
    RouteScannerService,
    EndpointScannerService,
    ManifestService,
  ],
  exports: [
    ComponentScannerService,
    RouteScannerService,
    EndpointScannerService,
    ManifestService,
  ],
})
export class ScannersModule {}
