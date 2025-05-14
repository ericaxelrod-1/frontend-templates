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
 * This service combines the results of component, route, and endpoint scanning
 * to create a comprehensive permissions manifest.
 */
@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);
  private readonly manifestPath: string;

  constructor(
    private readonly componentScanner: ComponentScannerService,
    private readonly routeScanner: RouteScannerService,
    private readonly endpointScanner: EndpointScannerService,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    private readonly cacheSyncService: CacheSyncService,
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
   * Generate a complete permission manifest
   */
  async generateManifest(): Promise<PermissionManifest> {
    this.logger.log('Generating permission manifest');
    
    try {
      // Run all scanners in parallel
      const [components, routes, endpoints] = await Promise.all([
        this.componentScanner.scanComponents(),
        this.routeScanner.scanRoutes(),
        this.endpointScanner.scanEndpoints(),
      ]);

      const manifest: PermissionManifest = {
        components,
        routes,
        endpoints,
        generated: new Date(),
      };

      // Save manifest to disk
      await this.saveManifest(manifest);

      this.logger.log('Permission manifest generated successfully');
      return manifest;
    } catch (error) {
      this.logger.error(`Error generating manifest: ${error.message}`, error.stack);
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
   * Register permissions discovered in the manifest
   */
  private async registerPermissions(manifest: PermissionManifest): Promise<void> {
    // Implementation would go here
    this.logger.log('Permission registration functionality would execute here');
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
} 