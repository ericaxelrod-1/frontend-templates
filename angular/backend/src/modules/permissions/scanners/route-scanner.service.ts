import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { FrontendRoute } from '../entities/frontend-route.entity';
import { Permission } from '../entities/permission.entity';
import { ConfigService } from '@nestjs/config';

/**
 * Interface for route information in the manifest
 */
export interface RouteInfo {
  path: string;
  id: string;
  component: string;
  description: string;
  requiredPermissions: string[];
}

/**
 * Interface for the route manifest
 */
export interface RouteManifest {
  routes: RouteInfo[];
  generated: Date;
}

/**
 * Service for scanning Angular route configurations to identify and register
 * routes with permission requirements
 */
@Injectable()
export class RouteScannerService {
  private readonly logger = new Logger(RouteScannerService.name);

  constructor(
    @InjectRepository(FrontendRoute)
    private readonly routeRepository: Repository<FrontendRoute>,

    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,

    private readonly configService: ConfigService,
  ) { }

  /**
   * Scan all routing modules to find routes with permission guards
   */
  async scanRoutes(): Promise<RouteManifest> {
    this.logger.log('Starting frontend route scan for permission requirements');

    const frontendPath = this.configService.get<string>('FRONTEND_PATH');
    if (!frontendPath) {
      this.logger.error(
        'FRONTEND_PATH not configured. Route scanning aborted.',
      );
      return { routes: [], generated: new Date() };
    }

    try {
      const routeInfos: RouteInfo[] = [];

      // Look for routing module files
      const routingModules = glob.sync(
        path.join(frontendPath, 'src/app/**/*-routing.module.ts'),
      );
      this.logger.log(`Found ${routingModules.length} routing modules to scan`);

      // Also scan app-routing.module.ts if it exists
      const appRoutingModule = path.join(
        frontendPath,
        'src/app/app-routing.module.ts',
      );
      if (fs.existsSync(appRoutingModule)) {
        routingModules.push(appRoutingModule);
      }

      // Process each routing module
      for (const routingModule of routingModules) {
        const moduleRoutes = await this.processRoutingModule(routingModule);
        routeInfos.push(...moduleRoutes);
      }

      this.logger.log(
        `Completed frontend route scan: ${routeInfos.length} routes with permissions found`,
      );

      return {
        routes: routeInfos,
        generated: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Error scanning frontend routes: ${error.message}`,
        error.stack,
      );
      return { routes: [], generated: new Date() };
    }
  }

  /**
   * Process a routing module file to extract routes with permissions
   */
  private async processRoutingModule(modulePath: string): Promise<RouteInfo[]> {
    try {
      const content = fs.readFileSync(modulePath, 'utf8');
      const routeInfos: RouteInfo[] = [];

      // Extract routes array definition
      const routesMatch = content.match(
        /const\s+routes\s*:\s*Routes\s*=\s*\[([\s\S]*?)\];/,
      );
      if (!routesMatch) return [];

      const routesContent = routesMatch[1];

      // Extract individual route objects
      const routeRegex = /{\s*path\s*:\s*['"]([^'"]+)['"]([\s\S]*?)},?/g;
      let routeMatch;

      while ((routeMatch = routeRegex.exec(routesContent)) !== null) {
        const path = routeMatch[1];
        const routeConfig = routeMatch[2];

        // Skip routes that are not secured
        if (
          !routeConfig.includes('PermissionGuard') &&
          !routeConfig.includes('data') &&
          !routeConfig.includes('permissionRule')
        ) {
          continue;
        }

        // Extract component name
        const componentMatch = routeConfig.match(/component\s*:\s*(\w+)/);
        const component = componentMatch ? componentMatch[1] : null;

        // Extract permission rules
        let requiredPermissions: string[] = [];

        // Look for permission rule notation
        const permRuleMatch = routeConfig.match(
          /permissionRule\s*:\s*['"]([^'"]+)['"]/,
        );
        if (permRuleMatch) {
          requiredPermissions.push(permRuleMatch[1]);
        }

        // Look for permission array notation
        const permArrayMatch = routeConfig.match(
          /permissionRule\s*:\s*\[([\s\S]*?)\]/,
        );
        if (permArrayMatch) {
          const arrayContent = permArrayMatch[1];
          const permItems = arrayContent.match(/['"]([^'"]+)['"]/g) || [];
          requiredPermissions = permItems.map((item) =>
            item.replace(/['"]/g, ''),
          );
        }

        // Look for permission object notation
        const permObjectMatch = routeConfig.match(
          /permissionRule\s*:\s*{([\s\S]*?)}/,
        );
        if (permObjectMatch) {
          const objectContent = permObjectMatch[1];
          const anyMatch = objectContent.match(/any\s*:\s*\[([\s\S]*?)\]/);
          const allMatch = objectContent.match(/all\s*:\s*\[([\s\S]*?)\]/);

          if (anyMatch) {
            const anyContent = anyMatch[1];
            const anyItems = anyContent.match(/['"]([^'"]+)['"]/g) || [];
            requiredPermissions = anyItems.map((item) =>
              item.replace(/['"]/g, ''),
            );
          } else if (allMatch) {
            const allContent = allMatch[1];
            const allItems = allContent.match(/['"]([^'"]+)['"]/g) || [];
            requiredPermissions = allItems.map((item) =>
              item.replace(/['"]/g, ''),
            );
          }
        }

        // Extract description
        let description = '';
        const descriptionMatch = routeConfig.match(/\/\*\s*([^*]*)\s*\*\//);
        if (descriptionMatch) {
          description = descriptionMatch[1].trim();
        }

        // Skip if no permissions found
        if (requiredPermissions.length === 0) continue;

        // Create a unique ID for the route
        const routeId = path.replace(/\//g, '_').replace(/:/g, 'param_');

        // Add route to results
        const routeInfo: RouteInfo = {
          id: routeId,
          path,
          component: component || '',
          description: description || `Route: ${path}`,
          requiredPermissions,
        };

        routeInfos.push(routeInfo);

        // Find or create the route entity
        let route = await this.routeRepository.findOne({ where: { id: path } });

        if (!route) {
          route = this.routeRepository.create({
            id: routeId,
            componentName: component || '',
            description: description || `Route: ${path}`,
            requiredPermissions: [],
            overridePermissions: false,
            lastSyncedAt: new Date(),
          });
        } else {
          // Only update if not overridden
          if (!route.overridePermissions) {
            route.componentName = component || route.componentName;
            route.description = description || route.description;
            route.lastSyncedAt = new Date();
          }
        }

        // If permissions are not overridden, update them
        if (!route.overridePermissions) {
          // Find permission entities
          const permissions = [];

          for (const permString of requiredPermissions) {
            const [resourceName, actionName] = permString.split(':');

            let permission = await this.permissionRepository.findOne({
              where: { name: permString },
            });

            if (!permission) {
              permission = this.permissionRepository.create({
                resourceName,
                name: permString,
                description: `Permission required by route ${path}`,
              });
              await this.permissionRepository.save(permission);
            }

            permissions.push(permission);
          }

          route.requiredPermissions = permissions;
        }

        await this.routeRepository.save(route);
        this.logger.debug(
          `Processed route ${path} with ${requiredPermissions.length} permissions`,
        );
      }

      return routeInfos;
    } catch (error) {
      this.logger.error(
        `Error processing routing module ${modulePath}: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }
}
