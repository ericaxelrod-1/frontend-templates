import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { UiComponent } from '../entities/ui-component.entity';
import { FrontendRoute } from '../entities/frontend-route.entity';
import { ApiEndpoint } from '../entities/api-endpoint.entity';
import { CacheService } from '../../cache/cache.service';
import { CacheSyncStatus } from '../cache-entities/cache-sync-status.entity';
import { CachePermissionMap } from '../cache-entities/cache-permission-map.entity';

interface CacheComponentMap {
  [id: number]: {
    selector: string;
    requiredPermissions: string[];
  };
}

interface CacheRouteMap {
  [id: number]: {
    path: string;
    requiredPermissions: string[];
  };
}

interface CacheEndpointMap {
  [id: number]: {
    method: string;
    path: string;
    requiredPermissions: string[];
  };
}

interface CachePermissionEntry {
  id: number;
  name: string;
  description: string | null;
}

interface PermissionMap {
  [key: string]: CachePermissionEntry;
}

/**
 * Service for synchronizing permissions data with cache
 * to improve performance of permission checks
 */
@Injectable()
export class CacheSyncService {
  private readonly CACHE_TTL = 3600; // 1 hour in seconds
  private readonly logger = new Logger(CacheSyncService.name);

  constructor(
    private readonly cacheService: CacheService,

    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,

    @InjectRepository(UiComponent)
    private readonly componentRepository: Repository<UiComponent>,

    @InjectRepository(FrontendRoute)
    private readonly routeRepository: Repository<FrontendRoute>,

    @InjectRepository(ApiEndpoint)
    private readonly endpointRepository: Repository<ApiEndpoint>,

    @InjectRepository(CacheSyncStatus)
    private readonly cacheSyncStatusRepository: Repository<CacheSyncStatus>,

    @InjectRepository(CachePermissionMap)
    private readonly cachePermissionMapRepository: Repository<CachePermissionMap>,
  ) {}

  /**
   * Synchronize all permissions data to cache
   */
  async syncPermissionsToCache(): Promise<void> {
    await Promise.all([
      this.syncComponentsToCache(),
      this.syncRoutesToCache(),
      this.syncEndpointsToCache(),
      this.syncPermissionMapToCache(),
    ]);
  }

  /**
   * Synchronize UI components to cache
   */
  private async syncComponentsToCache(): Promise<void> {
    const components = await this.componentRepository.find({
      relations: ['requiredPermissions'],
    });

    // Create a simplified map for faster lookups
    const componentPermissionsMap: CacheComponentMap = components.reduce(
      (map, component) => {
        map[component.id] = {
          selector: component.selector,
          requiredPermissions: component.requiredPermissions.map(
            (p) => `${p.resourceName}:${p.actionName}`,
          ),
        };
        return map;
      },
      {} as CacheComponentMap,
    );

    await this.cacheService.set(
      'component_permissions',
      componentPermissionsMap,
      this.CACHE_TTL,
    );
  }

  /**
   * Synchronize frontend routes to cache
   */
  private async syncRoutesToCache(): Promise<void> {
    const routes = await this.routeRepository.find({
      relations: ['requiredPermissions'],
    });

    // Create a simplified map for faster lookups
    const routePermissionsMap: CacheRouteMap = routes.reduce((map, route) => {
      map[route.id] = {
        path: route.path,
        requiredPermissions: route.requiredPermissions.map(
          (p) => `${p.resourceName}:${p.actionName}`,
        ),
      };
      return map;
    }, {} as CacheRouteMap);

    await this.cacheService.set(
      'route_permissions',
      routePermissionsMap,
      this.CACHE_TTL,
    );
  }

  /**
   * Synchronize API endpoints to cache
   */
  private async syncEndpointsToCache(): Promise<void> {
    const endpoints = await this.endpointRepository.find({
      relations: ['requiredPermissions'],
    });

    // Create a simplified map for faster lookups
    const endpointPermissionsMap: CacheEndpointMap = endpoints.reduce(
      (map, endpoint) => {
        map[endpoint.id] = {
          method: endpoint.method,
          path: endpoint.path,
          requiredPermissions: endpoint.requiredPermissions.map(
            (p) => `${p.resourceName}:${p.actionName}`,
          ),
        };
        return map;
      },
      {} as CacheEndpointMap,
    );

    await this.cacheService.set(
      'endpoint_permissions',
      endpointPermissionsMap,
      this.CACHE_TTL,
    );
  }

  /**
   * Create a map of all permissions for quick lookups
   */
  private async syncPermissionMapToCache(): Promise<void> {
    const permissions = await this.permissionRepository.find();

    const permissionMap: PermissionMap = permissions.reduce(
      (map, permission) => {
        const key = `${permission.resourceName}:${permission.actionName}`;
        map[key] = {
          id: permission.id,
          name: permission.name,
          description: permission.description,
        };
        return map;
      },
      {} as PermissionMap,
    );

    await this.cacheService.set(
      'permission_map',
      permissionMap,
      this.CACHE_TTL,
    );
  }

  /**
   * Clear all permissions from cache
   */
  async clearPermissionsCache(): Promise<void> {
    await Promise.all([
      this.cacheService.delete('component_permissions'),
      this.cacheService.delete('route_permissions'),
      this.cacheService.delete('endpoint_permissions'),
      this.cacheService.delete('permission_map'),
    ]);
  }

  /**
   * Force synchronization of all cache data
   * @returns Status of the synchronization operation
   */
  async forceSynchronization(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Force synchronization of permission cache initiated');

    try {
      // Clear existing cache
      await this.clearPermissionsCache();

      // Sync all permissions data to cache
      await this.syncPermissionsToCache();

      // Update sync status records
      const now = new Date();

      const entityTypes = ['component', 'route', 'endpoint', 'permission'];

      for (const entityType of entityTypes) {
        const existingStatus = await this.cacheSyncStatusRepository.findOne({
          where: { id: entityType },
        });

        if (existingStatus) {
          existingStatus.lastSyncTime = now;
          existingStatus.syncSuccessful = true;
          existingStatus.error = null;
          await this.cacheSyncStatusRepository.save(existingStatus);
        } else {
          const newStatus = this.cacheSyncStatusRepository.create({
            id: entityType,
            entityType,
            lastSyncTime: now,
            syncSuccessful: true,
            syncStats: {
              added: 0,
              updated: 0,
              deleted: 0,
              unchanged: 0,
              errors: 0,
            },
          });
          await this.cacheSyncStatusRepository.save(newStatus);
        }
      }

      this.logger.log('Force synchronization completed successfully');
      return {
        success: true,
        message: 'Cache synchronization completed successfully',
      };
    } catch (error) {
      this.logger.error(
        `Cache synchronization failed: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        message: `Cache synchronization failed: ${error.message}`,
      };
    }
  }

  /**
   * Get the current synchronization status
   * @returns Array of sync status entities
   */
  async getSyncStatus(): Promise<CacheSyncStatus[]> {
    return this.cacheSyncStatusRepository.find();
  }

  /**
   * Format a permission string from resource and action names
   */
  private formatPermissionString(
    resourceName: string,
    actionName: string,
  ): string {
    return `${resourceName}:${actionName}`;
  }

  /**
   * Synchronize a permission to cache
   */
  async syncPermission(permission: Permission): Promise<void> {
    const cacheEntry: DeepPartial<CachePermissionMap> = {
      type: 'permission',
      name: permission.name,
      resourceType: permission.resourceName,
      resourceId: permission.id.toString(),
      action: permission.actionName,
      granted: true,
      priority: 0,
      lastSynced: new Date(),
    };
    await this.cachePermissionMapRepository.save(cacheEntry);
  }

  async removePermission(id: number): Promise<void> {
    await this.cachePermissionMapRepository.delete({ resourceId: id.toString() });
  }

  /**
   * Synchronize a UI component to cache
   */
  async syncComponent(component: UiComponent): Promise<void> {
    const cacheEntry: DeepPartial<CachePermissionMap> = {
      type: 'component',
      name: component.selector,
      resourceType: 'ui-component',
      resourceId: component.id,
      granted: true,
      priority: 1,
      lastSynced: new Date(),
      action: 'access', // Default action for components
    };

    await this.cachePermissionMapRepository.save(cacheEntry);
  }

  /**
   * Synchronize a frontend route to cache
   */
  async syncRoute(route: FrontendRoute): Promise<void> {
    const cacheEntry: DeepPartial<CachePermissionMap> = {
      type: 'route',
      name: route.path,
      resourceType: 'frontend-route',
      resourceId: route.id,
      granted: true,
      priority: 1,
      lastSynced: new Date(),
    };

    if (route.requiredPermissions) {
      cacheEntry.permissions = route.requiredPermissions.map((p) =>
        this.formatPermissionString(p.resourceName, p.actionName),
      );
    }

    await this.cachePermissionMapRepository.save(cacheEntry);
  }

  /**
   * Synchronize an API endpoint to cache
   */
  async syncEndpoint(endpoint: ApiEndpoint): Promise<void> {
    const cacheEntry: DeepPartial<CachePermissionMap> = {
      type: 'endpoint',
      name: `${endpoint.method} ${endpoint.path}`,
      resourceType: 'api-endpoint',
      resourceId: endpoint.id,
      granted: true,
      priority: 1,
      lastSynced: new Date(),
      action: endpoint.method.toLowerCase(), // Use HTTP method as action
    };

    if (endpoint.requiredPermissions) {
      cacheEntry.permissions = endpoint.requiredPermissions.map((p) =>
        this.formatPermissionString(p.resourceName, p.actionName),
      );
    }

    await this.cachePermissionMapRepository.save(cacheEntry);
  }

  /**
   * Get user permissions from cache
   */
  async getUserPermissions(userId: number): Promise<string[]> {
    const cacheKey = `user-permissions:${userId}`;
    let permissions = await this.cacheService.get<string[]>(cacheKey);

    if (!permissions) {
      const entries = await this.cachePermissionMapRepository.find({
        where: {
          userId,
          granted: true,
        },
      });

      permissions = entries.map((entry) =>
        this.formatPermissionString(entry.resourceType, entry.action),
      );

      await this.cacheService.set(cacheKey, permissions, this.CACHE_TTL);
    }

    return permissions;
  }
}
