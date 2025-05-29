import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DiscoveryService } from '@nestjs/core';
import { PermissionsService } from '../modules/permissions/services/permissions.service';
import { ManifestService } from '../modules/permissions/scanners/manifest.service';
import { ComponentScannerService } from '../modules/permissions/scanners/component-scanner.service';
import { RouteScannerService } from '../modules/permissions/scanners/route-scanner.service';
import { EndpointScannerService } from '../modules/permissions/scanners/endpoint-scanner.service';
import { CacheSyncService } from '../modules/cache/cache-sync.service';

/**
 * Script to scan the entire application for components, routes, and API endpoints
 * then update the permissions database and cache
 */
async function bootstrap() {
  // Create NestJS application
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  try {
    console.log('Starting application scan for permission requirements...');

    // Get required services
    const discoveryService = app.get(DiscoveryService);
    const permissionsService = app.get(PermissionsService);
    const manifestService = app.get(ManifestService);
    const componentScanner = app.get(ComponentScannerService);
    const routeScanner = app.get(RouteScannerService);
    const endpointScanner = app.get(EndpointScannerService);
    const cacheSyncService = app.get(CacheSyncService);

    console.log('Scanning Angular components...');
    const componentManifest = await componentScanner.scanComponents();
    console.log(
      `Found ${componentManifest.components.length} components with permissions`,
    );

    console.log('Scanning Angular routes...');
    const routeManifest = await routeScanner.scanRoutes();
    console.log(`Found ${routeManifest.routes.length} routes with permissions`);

    console.log('Scanning API endpoints...');
    const endpointManifest = await endpointScanner.scanEndpoints();
    console.log(
      `Found ${endpointManifest.endpoints.length} API endpoints with permissions`,
    );

    // Generate manifest
    console.log('Generating permission manifest...');
    await manifestService.generateManifest();

    // Sync permissions to database and cache
    console.log('Synchronizing permissions to database...');
    await permissionsService.syncPermissionsFromManifest();

    // Sync permissions to cache
    console.log('Syncing permissions to cache...');
    await cacheSyncService.syncAllPermissions();

    console.log('Scan and synchronization completed successfully');

    await app.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during permission scanning:', error);
    await app.close();
    process.exit(1);
  }
}

// Run the scanner
bootstrap();
