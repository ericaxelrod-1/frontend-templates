import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  ComponentScannerService,
  ComponentManifest,
} from './component-scanner.service';
import { RouteScannerService, RouteManifest } from './route-scanner.service';
import {
  EndpointScannerService,
  EndpointManifest,
} from './endpoint-scanner.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { CacheSyncService } from '../../cache/cache-sync.service';

export interface PermissionManifest {
  components: ComponentManifest;
  routes: RouteManifest;
  endpoints: EndpointManifest;
  generated: Date;
}

/**
 * Service for generating and managing the permission manifest.
 * This service coordinates the scanning of components, routes, and endpoints.
 */
@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);
  private readonly manifestPath: string;

  constructor(
    private readonly componentScannerService: ComponentScannerService,
    private readonly routeScannerService: RouteScannerService,
    private readonly endpointScannerService: EndpointScannerService,
    private readonly cacheSyncService: CacheSyncService,

    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
  ) {
    // Set manifest path
    this.manifestPath = path.join(
      process.cwd(),
      'cache',
      'permission-manifest.json',
    );
    this.logger.log(`Manifest path set to: ${this.manifestPath}`);
  }

  /**
   * Generate a complete manifest by scanning all sources
   */
  async generateManifest(): Promise<PermissionManifest> {
    this.logger.log('Starting permission manifest generation');

    try {
      // Clear the cache before scanning
      await this.cacheSyncService.clearAllPermissions();

      // Perform scans in parallel
      const [components, routes, endpoints] = await Promise.all([
        this.componentScannerService.scanComponents(),
        this.routeScannerService.scanRoutes(),
        this.endpointScannerService.scanEndpoints(),
      ]);

      // Create manifest
      const manifest: PermissionManifest = {
        components,
        routes,
        endpoints,
        generated: new Date(),
      };

      // Save manifest to disk
      await this.saveManifest(manifest);

      // Register all discovered permissions
      await this.registerPermissions(manifest);

      // Sync all permissions to cache - using 'permissions' as resource type and 0 as a generic ID
      await this.cacheSyncService.syncPermissions('permissions', 0);

      this.logger.log('Permission manifest generation completed successfully');

      return manifest;
    } catch (error) {
      this.logger.error(
        `Error generating permission manifest: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Save manifest to disk.
   */
  private async saveManifest(manifest: PermissionManifest): Promise<void> {
    try {
      // Create cache directory if it doesn't exist
      const cacheDir = path.dirname(this.manifestPath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Write manifest to disk
      fs.writeFileSync(
        this.manifestPath,
        JSON.stringify(manifest, null, 2),
        'utf-8',
      );

      this.logger.log(`Manifest saved to ${this.manifestPath}`);
    } catch (error) {
      this.logger.error(`Error saving manifest: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get manifest from disk or generate a new one if it doesn't exist.
   */
  async getManifest(): Promise<PermissionManifest> {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const manifestJson = fs.readFileSync(this.manifestPath, 'utf-8');
        return JSON.parse(manifestJson);
      }
    } catch (error) {
      this.logger.error(`Error reading manifest: ${error.message}`);
    }

    // Generate new manifest if none exists or error occurs
    return this.generateManifest();
  }

  /**
   * Register all permissions discovered in the manifest.
   */
  private async registerPermissions(
    manifest: PermissionManifest,
  ): Promise<void> {
    this.logger.log('Registering discovered permissions...');

    try {
      // Collect all permission strings from components, routes, and endpoints
      const allPermissions = new Set<string>();

      // From components
      manifest.components.components.forEach((component) => {
        component.requiredPermissions.forEach((perm) =>
          allPermissions.add(perm),
        );
      });

      // From routes
      manifest.routes.routes.forEach((route) => {
        route.requiredPermissions.forEach((perm) => allPermissions.add(perm));
      });

      // From endpoints
      manifest.endpoints.endpoints.forEach((endpoint) => {
        endpoint.requiredPermissions.forEach((perm) =>
          allPermissions.add(perm),
        );
      });

      this.logger.log(
        `Found ${allPermissions.size} unique permissions to register`,
      );

      // Register each permission
      for (const permString of allPermissions) {
        await this.ensurePermissionExists(permString);
      }

      this.logger.log('Permission registration completed');
    } catch (error) {
      this.logger.error(`Error registering permissions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure a permission exists in the database.
   */
  private async ensurePermissionExists(permString: string): Promise<void> {
    try {
      // Parse permission string (format: resource:action)
      const [resourceName, actionName] = permString.split(':');

      if (!resourceName || !actionName) {
        this.logger.warn(`Invalid permission format: ${permString}`);
        return;
      }

      // Check if permission already exists
      let permission = await this.permissionRepo.findOne({
        where: { resourceName, actionName },
      });

      if (!permission) {
        // Create new permission
        permission = this.permissionRepo.create({
          resourceName,
          actionName,
          name: permString,
          description: `Permission for ${permString}`,
        });

        await this.permissionRepo.save(permission);
        this.logger.debug(`Created permission: ${permString}`);
      }
    } catch (error) {
      this.logger.error(
        `Error ensuring permission exists (${permString}): ${error.message}`,
      );
      throw error;
    }
  }
}
