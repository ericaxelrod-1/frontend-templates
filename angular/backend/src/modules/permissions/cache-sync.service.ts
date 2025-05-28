import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import {
  CacheComponent,
  CacheRoute,
  CacheEndpoint,
  CachePermissionMap,
  CacheSyncStatus,
} from './cache-entities';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { GroupPermission } from './entities/group-permission.entity';
import { UserPermission } from './entities/user-permission.entity';
import { ManifestService } from './scanners';
import { Role } from '../users/entities/role.entity';
import { Group } from '../users/entities/group.entity';
import { User } from '../users/entities/user.entity';

/**
 * Service responsible for synchronizing the main database with the SQLite cache.
 * This improves performance by allowing permission checks to use the cache instead of the main database.
 */
@Injectable()
export class CacheSyncService implements OnModuleInit {
  private readonly logger = new Logger('CacheSyncService');
  private nextId = 1; // Counter for generating numeric IDs

  constructor(
    @InjectRepository(CacheComponent, 'cacheConnection')
    private readonly cacheComponentRepo: Repository<CacheComponent>,

    @InjectRepository(CacheRoute, 'cacheConnection')
    private readonly cacheRouteRepo: Repository<CacheRoute>,

    @InjectRepository(CacheEndpoint, 'cacheConnection')
    private readonly cacheEndpointRepo: Repository<CacheEndpoint>,

    @InjectRepository(CachePermissionMap, 'cacheConnection')
    private readonly cachePermissionMapRepo: Repository<CachePermissionMap>,

    @InjectRepository(CacheSyncStatus, 'cacheConnection')
    private readonly cacheSyncStatusRepo: Repository<CacheSyncStatus>,

    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,

    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,

    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepo: Repository<GroupPermission>,

    @InjectRepository(UserPermission)
    private readonly userPermissionRepo: Repository<UserPermission>,

    private readonly cacheDataSource: DataSource,
    private readonly manifestService: ManifestService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Get the next available numeric ID
   */
  private getNextId(): number {
    return this.nextId++;
  }

  /**
   * Initialize the cache on application startup.
   */
  async onModuleInit() {
    this.logger.log('Initializing permission cache database...');
    try {
      await this.syncAll();
      this.logger.log('Permission cache initialized successfully.');
    } catch (error) {
      this.logger.error(
        `Failed to initialize permission cache: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Synchronize all data between the main database and the cache.
   * This is a full sync operation.
   */
  async syncAll(): Promise<void> {
    this.logger.log('Starting full synchronization...');

    try {
      // Generate manifest to discover components, routes, and endpoints
      await this.manifestService.generateManifest();

      // Reset ID counter
      this.nextId = 1;

      // Use transaction to ensure consistency
      await this.cacheDataSource.transaction(async (manager) => {
        await this.syncPermissions(manager);
        await this.syncRolePermissions(manager);
        await this.syncGroupPermissions(manager);
        await this.syncUserPermissions(manager);
        await this.syncComponents(manager);
        await this.syncRoutes(manager);
        await this.syncEndpoints(manager);

        // Update sync status
        await this.updateSyncStatus('all', true);
      });

      this.logger.log('Full synchronization completed successfully.');
    } catch (error) {
      this.logger.error(
        `Full synchronization failed: ${error.message}`,
        error.stack,
      );
      await this.updateSyncStatus('all', false, error.message);
      throw error;
    }
  }

  /**
   * Synchronize permissions from the main database to the cache.
   */
  private async syncPermissions(manager: any): Promise<void> {
    this.logger.log('Synchronizing permissions...');

    // Clear existing permission cache
    await manager.clear(CachePermissionMap);

    // Get all permissions with relationships
    const permissions = await this.permissionRepo.find({
      relations: [
        'rolePermissions',
        'groupPermissions',
        'userPermissions',
        'uiComponent',
        'apiEndpoint',
        'frontendRoute',
      ],
    });

    // Create cache entries for each permission
    const cacheEntries = permissions.map((permission) => {
      const cacheEntry = new CachePermissionMap();
      cacheEntry.type = 'permission';
      cacheEntry.name = `${permission.resourceName}:${permission.actionName}`;
      cacheEntry.resourceType = permission.resourceName;
      cacheEntry.resourceId = permission.id.toString();
      cacheEntry.action = permission.actionName;
      cacheEntry.granted = true;
      cacheEntry.priority = 0;
      return cacheEntry;
    });

    await manager.save(CachePermissionMap, cacheEntries);

    this.logger.log(`Synchronized ${cacheEntries.length} permission maps.`);
  }

  /**
   * Synchronize role permissions from the main database to the cache.
   */
  private async syncRolePermissions(manager: any): Promise<void> {
    this.logger.log('Synchronizing role permissions...');

    // Clear existing role permission cache
    await manager.clear(CachePermissionMap);

    // Get all roles with their permissions
    const roles = await this.roleRepository.find({
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });

    // Create cache entries for each role's permissions
    const cacheEntries: CachePermissionMap[] = [];
    for (const role of roles) {
      for (const rolePermission of role.rolePermissions) {
        const permission = rolePermission.permission;
        const cacheEntry = new CachePermissionMap();
        cacheEntry.type = 'role';
        cacheEntry.name = role.name;
        cacheEntry.resourceType = permission.resourceName;
        cacheEntry.resourceId = permission.id.toString();
        cacheEntry.action = permission.actionName;
        cacheEntry.roleId = role.id;
        cacheEntry.granted = rolePermission.granted;
        cacheEntry.priority = 1;
        cacheEntries.push(cacheEntry);
      }
    }

    await manager.save(CachePermissionMap, cacheEntries);

    this.logger.log(
      `Synchronized ${cacheEntries.length} role permission maps.`,
    );
  }

  /**
   * Synchronize group permissions from the main database to the cache.
   */
  private async syncGroupPermissions(manager: any): Promise<void> {
    this.logger.log('Synchronizing group permissions...');

    // Clear existing group permission cache
    await manager.clear(CachePermissionMap);

    // Get all groups with their permissions
    const groups = await this.groupRepository.find({
      relations: ['groupPermissions', 'groupPermissions.permission'],
    });

    // Create cache entries for each group's permissions
    const cacheEntries: CachePermissionMap[] = [];
    for (const group of groups) {
      for (const groupPermission of group.groupPermissions) {
        const permission = groupPermission.permission;
        const cacheEntry = new CachePermissionMap();
        cacheEntry.type = 'group';
        cacheEntry.name = group.name;
        cacheEntry.resourceType = permission.resourceName;
        cacheEntry.resourceId = permission.id.toString();
        cacheEntry.action = permission.actionName;
        cacheEntry.groupId = group.id;
        cacheEntry.granted = groupPermission.granted;
        cacheEntry.priority = 2;
        cacheEntries.push(cacheEntry);
      }
    }

    await manager.save(CachePermissionMap, cacheEntries);

    this.logger.log(
      `Synchronized ${cacheEntries.length} group permission maps.`,
    );
  }

  /**
   * Synchronize user permissions from the main database to the cache.
   */
  private async syncUserPermissions(manager: any): Promise<void> {
    this.logger.log('Synchronizing user permissions...');

    // Clear existing user permission cache
    await manager.clear(CachePermissionMap);

    // Get all users with their permissions
    const users = await this.userRepository.find({
      relations: ['userPermissions', 'userPermissions.permission'],
    });

    // Create cache entries for each user's permissions
    const cacheEntries: CachePermissionMap[] = [];
    for (const user of users) {
      for (const userPermission of user.userPermissions) {
        const permission = userPermission.permission;
        const cacheEntry = new CachePermissionMap();
        cacheEntry.type = 'user';
        cacheEntry.name = user.username;
        cacheEntry.resourceType = permission.resourceName;
        cacheEntry.resourceId = permission.id.toString();
        cacheEntry.action = permission.actionName;
        cacheEntry.userId = user.id;
        cacheEntry.granted = userPermission.granted;
        cacheEntry.priority = 3;
        cacheEntries.push(cacheEntry);
      }
    }

    await manager.save(CachePermissionMap, cacheEntries);

    this.logger.log(
      `Synchronized ${cacheEntries.length} user permission maps.`,
    );
  }

  /**
   * Synchronize components from the manifest to the cache.
   */
  private async syncComponents(manager: any): Promise<void> {
    this.logger.log('Synchronizing UI components...');

    try {
      // Get manifest
      const manifest = await this.manifestService.getManifest();
      const components = manifest.components.components;

      this.logger.log(`Found ${components.length} components in manifest`);

      // Clear existing cache components
      await manager.clear(CacheComponent);

      // Create new cache components
      const cacheComponents: Partial<CacheComponent>[] = [];

      for (const component of components) {
        cacheComponents.push({
          selector: component.selector,
          description: component.description,
          filePath: component.filePath || null,
          lastSyncedAt: new Date(),
          metadata: JSON.stringify(component.requiredPermissions || []),
        });
      }

      // Save to cache
      if (cacheComponents.length > 0) {
        await manager.save(CacheComponent, cacheComponents);
      }

      this.logger.log(`Synchronized ${cacheComponents.length} UI components.`);
    } catch (error) {
      this.logger.error(`Error synchronizing components: ${error.message}`);
      throw error;
    }
  }

  /**
   * Synchronize routes from the manifest to the cache.
   */
  private async syncRoutes(manager: any): Promise<void> {
    this.logger.log('Synchronizing routes...');

    try {
      // Get manifest
      const manifest = await this.manifestService.getManifest();
      const routes = manifest.routes.routes;

      this.logger.log(`Found ${routes.length} routes in manifest`);

      // Clear existing cache routes
      await manager.clear(CacheRoute);

      // Create new cache routes
      const cacheRoutes: Partial<CacheRoute>[] = [];

      for (const route of routes) {
        cacheRoutes.push({
          path: route.path,
          description: route.description,
          componentName: route.component || null,
          lastSyncedAt: new Date(),
          metadata: JSON.stringify(route.requiredPermissions || []),
        });
      }

      // Save to cache
      if (cacheRoutes.length > 0) {
        await manager.save(CacheRoute, cacheRoutes);
      }

      this.logger.log(`Synchronized ${cacheRoutes.length} routes.`);
    } catch (error) {
      this.logger.error(`Error synchronizing routes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Synchronize endpoints from the manifest to the cache.
   */
  private async syncEndpoints(manager: any): Promise<void> {
    this.logger.log('Synchronizing endpoints...');

    try {
      // Get manifest
      const manifest = await this.manifestService.getManifest();
      const endpoints = manifest.endpoints.endpoints;

      this.logger.log(`Found ${endpoints.length} endpoints in manifest`);

      // Clear existing cache endpoints
      await manager.clear(CacheEndpoint);

      // Create new cache endpoints
      const cacheEndpoints: Partial<CacheEndpoint>[] = [];

      for (const endpoint of endpoints) {
        cacheEndpoints.push({
          method: endpoint.method,
          path: endpoint.path,
          description: endpoint.description,
          controllerName: endpoint.controllerName || null,
          handlerName: endpoint.handlerName || null,
          lastSyncedAt: new Date(),
          metadata: JSON.stringify(endpoint.requiredPermissions || []),
        });
      }

      // Save to cache
      if (cacheEndpoints.length > 0) {
        await manager.save(CacheEndpoint, cacheEndpoints);
      }

      this.logger.log(`Synchronized ${cacheEndpoints.length} endpoints.`);
    } catch (error) {
      this.logger.error(`Error synchronizing endpoints: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update the sync status record.
   */
  private async updateSyncStatus(
    entityType: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    const id = `sync-${entityType}`;
    const now = new Date();

    // Try to update existing record
    const existingStatus = await this.cacheSyncStatusRepo.findOne({
      where: { id },
    });

    if (existingStatus) {
      await this.cacheSyncStatusRepo.update(id, {
        lastSyncTime: now,
        syncSuccessful: success,
        error: error || null,
      });
    } else {
      // Create new record if it doesn't exist
      await this.cacheSyncStatusRepo.save({
        id,
        entityType,
        lastSyncTime: now,
        syncSuccessful: success,
        error: error || null,
        syncStats: {
          added: 0,
          updated: 0,
          deleted: 0,
          unchanged: 0,
          errors: 0,
        },
      });
    }
  }

  /**
   * Schedule full synchronization to run every 5 minutes.
   */
  @Cron('*/5 * * * *')
  async scheduledSync() {
    this.logger.log('Running scheduled cache synchronization...');
    try {
      await this.syncAll();
    } catch (error) {
      this.logger.error('Scheduled synchronization failed', error.stack);
    }
  }

  /**
   * Force a synchronization of the cache.
   * This is exposed as an API endpoint for admin users.
   */
  async forceSynchronization(): Promise<{ success: boolean; message: string }> {
    try {
      await this.syncAll();
      return {
        success: true,
        message: 'Cache synchronization completed successfully.',
      };
    } catch (error) {
      return {
        success: false,
        message: `Cache synchronization failed: ${error.message}`,
      };
    }
  }

  /**
   * Get synchronization status.
   */
  async getSyncStatus(): Promise<CacheSyncStatus[]> {
    return this.cacheSyncStatusRepo.find();
  }
}
