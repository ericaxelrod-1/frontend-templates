import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, FindOperator, DeepPartial, Like } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { UiComponent } from '../entities/ui-component.entity';
import { FrontendRoute } from '../entities/frontend-route.entity';
import { ApiEndpoint } from '../entities/api-endpoint.entity';
import { User } from '../../users/entities/user.entity';
import { CacheService } from '../../cache/cache.service';
import { RolePermission } from '../entities/role-permission.entity';
import { GroupPermission } from '../entities/group-permission.entity';
import { UserPermission } from '../entities/user-permission.entity';
import { Group } from '../entities/group.entity';
import { EntityManager } from 'typeorm';
import {
  FrontendRouteDto,
  ApiEndpointDto,
  UpdateResourceDto,
  UpdateActionDto,
  CreateActionDto,
} from '../dtos';
import { Resource } from '../entities/resource.entity';
import { Action } from '../entities/action.entity';
import { CacheSyncService } from '../../cache/cache-sync.service';
import { RequestContext } from '../../shared/request-context';
import { ManifestService } from '../scanners/manifest.service';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  private readonly CACHE_PREFIX = 'permission:';
  private readonly CACHE_TTL = 3600; // 1 hour in seconds

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,

    @InjectRepository(Role)
    private roleRepository: Repository<Role>,

    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,

    @InjectRepository(UiComponent)
    private componentRepository: Repository<UiComponent>,

    @InjectRepository(FrontendRoute)
    private routeRepository: Repository<FrontendRoute>,

    @InjectRepository(ApiEndpoint)
    private endpointRepository: Repository<ApiEndpoint>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    @InjectRepository(Group)
    private groupRepository: Repository<Group>,

    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepository: Repository<GroupPermission>,

    @InjectRepository(UserPermission)
    private readonly userPermissionRepository: Repository<UserPermission>,

    @InjectRepository(Resource)
    private resourceRepository: Repository<Resource>,

    private cacheService: CacheService,
    private manifestService: ManifestService,
    private moduleRef: ModuleRef,
    private entityManager: EntityManager,
    @InjectRepository(Action)
    private actionRepository: Repository<Action>,
    private readonly cacheSyncService: CacheSyncService,
  ) {}

  /**
   * Get all available permissions
   */
  async getAllPermissions(): Promise<Permission[]> {
    return this.permissionRepository.find();
  }

  /**
   * Parse permission strings into Permission entities
   * Format: "resource:action"
   */
  private async parsePermissionStrings(
    permissionStrings: string[],
  ): Promise<Permission[]> {
    const permissions: Permission[] = [];

    for (const permissionString of permissionStrings) {
      const [resourceName, actionName] = permissionString.split(':');

      if (!resourceName || !actionName) {
        this.logger.warn(
          `Invalid permission string format: ${permissionString}`,
        );
        continue;
      }

      // Find or create the Action entity
      let action = await this.actionRepository.findOne({
        where: { name: actionName },
      });

      if (!action) {
        action = await this.actionRepository.save({
          name: actionName,
          actionCode: actionName,
          description: `${actionName} action`,
        });
        this.logger.debug(`Created new action: ${actionName}`);
      }

      let permission = await this.permissionRepository.findOne({
        where: {
          resourceName,
          actionId: action.id,
        },
        relations: ['actionEntity'],
      });

      if (!permission) {
        permission = this.permissionRepository.create({
          resourceName,
          actionId: action.id,
          name: `${resourceName}:${actionName}`,
          description: `Permission to ${actionName} ${resourceName}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        permission = await this.permissionRepository.save(permission);
        this.logger.debug(
          `Created new permission: ${resourceName}:${actionName}`,
        );
      }

      permissions.push(permission);
    }

    return permissions;
  }

  /**
   * Get all permissions for a specific user
   */
  async getUserPermissions(userId: number): Promise<string[]> {
    // Check cache first
    const cachedPermissions =
      await this.cacheService.getUserPermissions(userId);
    if (cachedPermissions) {
      this.logger.debug(`Cache hit for user permissions: ${userId}`);
      return cachedPermissions;
    }

    this.logger.debug(
      `Cache miss for user permissions: ${userId}, fetching from database`,
    );

    // Fetch user with roles, role permissions, groups, and group permissions
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: [
        'roles',
        'roles.rolePermissions',
        'roles.rolePermissions.permission',
        'roles.rolePermissions.permission.actionEntity',
        'groups',
        'groups.groupPermissions',
        'groups.groupPermissions.permission',
        'groups.groupPermissions.permission.actionEntity',
        'userPermissions',
        'userPermissions.permission',
        'userPermissions.permission.actionEntity',
      ],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const permissions: string[] = [];

    // Add role permissions
    for (const role of user.roles || []) {
      if (role.rolePermissions) {
        for (const rolePermission of role.rolePermissions) {
          if (rolePermission.permission && rolePermission.isGranted !== false) {
            const permission = rolePermission.permission;
            const permString = `${permission.resourceName}:${permission.actionName}`;
            if (!permissions.includes(permString)) {
              permissions.push(permString);
            }
          }
        }
      }
    }

    // Add group permissions - only use the newer structure with groupPermissions
    for (const group of user.groups || []) {
      if (group.groupPermissions) {
        for (const groupPermission of group.groupPermissions) {
          if (
            groupPermission.permission &&
            groupPermission.isGranted !== false
          ) {
            const permission = groupPermission.permission;
            const permString = `${permission.resourceName}:${permission.actionName}`;
            if (!permissions.includes(permString)) {
              permissions.push(permString);
            }
          }
        }
      }
    }

    // Add direct user permissions
    for (const userPermission of user.userPermissions || []) {
      if (userPermission.permission && userPermission.isGranted !== false) {
        const permission = userPermission.permission;
        const permString = `${permission.resourceName}:${permission.actionName}`;
        if (!permissions.includes(permString)) {
          permissions.push(permString);
        }
      }
    }

    // Cache the permissions
    await this.cacheService.cacheUserPermissions(
      userId,
      permissions,
      this.CACHE_TTL,
    );

    return permissions;
  }

  /**
   * Get all UI components with their permissions
   */
  async getAllComponents(): Promise<UiComponent[]> {
    return this.componentRepository.find({
      relations: ['requiredPermissions'],
    });
  }

  /**
   * Get a component by ID
   */
  async getComponentById(id: string): Promise<UiComponent> {
    const component = await this.componentRepository.findOne({
      where: { id },
      relations: ['requiredPermissions'],
    });

    if (!component) {
      throw new NotFoundException(`Component with ID ${id} not found`);
    }

    return component;
  }

  /**
   * Update component permissions
   */
  async updateComponentPermissions(
    id: string,
    requiredPermissions: string[],
    overridePermissions: boolean,
  ): Promise<UiComponent> {
    const component = await this.getComponentById(id);

    // Parse permission strings to get resource and action names
    const permissions = await this.parsePermissionStrings(requiredPermissions);

    component.requiredPermissions = permissions;
    component.overridePermissions = overridePermissions;
    component.lastSynced = new Date();

    return this.componentRepository.save(component);
  }

  /**
   * Get all routes with their permissions
   */
  async getAllRoutes(): Promise<FrontendRoute[]> {
    return this.routeRepository.find({
      relations: ['requiredPermissions'],
    });
  }

  /**
   * Get a route by ID
   */
  async getRouteById(id: string): Promise<FrontendRoute> {
    const route = await this.routeRepository.findOne({
      where: { id },
      relations: ['requiredPermissions'],
    });

    if (!route) {
      throw new NotFoundException(`Route with ID ${id} not found`);
    }

    return route;
  }

  /**
   * Update route permissions
   */
  async updateRoutePermissions(
    id: string,
    requiredPermissions: string[],
    overridePermissions: boolean,
  ): Promise<FrontendRoute> {
    const route = await this.getRouteById(id);

    // Parse permission strings to get resource and action names
    const permissions = await this.parsePermissionStrings(requiredPermissions);

    route.requiredPermissions = permissions;
    route.overridePermissions = overridePermissions;
    route.lastSynced = new Date();

    return this.routeRepository.save(route);
  }

  /**
   * Check if a user has access to a specific frontend route
   */
  async canUserAccessRoute(userId: number, path: string): Promise<boolean> {
    const cacheKey = `route-access:${userId}:${path}`;

    // Check if access decision is cached
    const cachedAccess = this.cacheService.get<boolean>(cacheKey);
    if (cachedAccess !== undefined) {
      this.logger.debug(`Cache hit for route access: ${cacheKey}`);
      return cachedAccess;
    }

    this.logger.debug(`Cache miss for route access: ${cacheKey}, calculating`);

    // Get user permissions
    const userPermissions = await this.getUserPermissions(userId);

    // Find the route by path
    const route = await this.routeRepository.findOne({
      where: { path },
      relations: ['requiredPermissions'],
    });

    // If route doesn't exist or has no permission requirements, allow access
    if (
      !route ||
      !route.requiredPermissions ||
      route.requiredPermissions.length === 0
    ) {
      const result = true;
      this.cacheService.set(cacheKey, result, this.CACHE_TTL);
      return result;
    }

    // Check if user has any of the required permissions
    const requiredPermissionStrings = route.requiredPermissions.map(
      (p) => `${p.resourceName}:${p.actionName}`,
    );

    const hasAccess = requiredPermissionStrings.some((permission) =>
      userPermissions.includes(permission),
    );

    // Cache the result
    this.cacheService.set(cacheKey, hasAccess, this.CACHE_TTL);

    return hasAccess;
  }

  /**
   * Get all API endpoints with their permissions
   */
  async getAllEndpoints(): Promise<ApiEndpoint[]> {
    return this.endpointRepository.find({
      relations: ['requiredPermissions'],
    });
  }

  /**
   * Get an endpoint by ID
   */
  async getEndpointById(id: string): Promise<ApiEndpoint> {
    const endpoint = await this.endpointRepository.findOne({
      where: { id },
      relations: ['requiredPermissions'],
    });

    if (!endpoint) {
      throw new NotFoundException(`Endpoint with ID ${id} not found`);
    }

    return endpoint;
  }

  /**
   * Update endpoint permissions
   */
  async updateEndpointPermissions(
    id: string,
    requiredPermissions: string[],
    overridePermissions: boolean,
  ): Promise<ApiEndpoint> {
    const endpoint = await this.getEndpointById(id);

    // Parse permission strings to get resource and action names
    const permissions = await this.parsePermissionStrings(requiredPermissions);

    endpoint.requiredPermissions = permissions;
    endpoint.overridePermissions = overridePermissions;
    endpoint.lastSynced = new Date();

    return this.endpointRepository.save(endpoint);
  }

  /**
   * Check if a user has access to a specific endpoint
   */
  async canUserAccessEndpoint(
    userId: number,
    path: string,
    method: string,
  ): Promise<boolean> {
    const cacheKey = `endpoint-access:${userId}:${method}:${path}`;

    // Check if access decision is cached
    const cachedAccess = this.cacheService.get<boolean>(cacheKey);
    if (cachedAccess !== undefined) {
      this.logger.debug(`Cache hit for endpoint access: ${cacheKey}`);
      return cachedAccess;
    }

    this.logger.debug(
      `Cache miss for endpoint access: ${cacheKey}, calculating`,
    );

    // Get user permissions
    const userPermissions = await this.getUserPermissions(userId);

    // Find the endpoint
    const endpoint = await this.endpointRepository.findOne({
      where: { path, method },
      relations: ['requiredPermissions'],
    });

    // If endpoint doesn't exist or doesn't have permission requirements, allow access
    if (
      !endpoint ||
      !endpoint.requiredPermissions ||
      endpoint.requiredPermissions.length === 0
    ) {
      this.cacheService.set(cacheKey, true, this.CACHE_TTL);
      return true;
    }

    // Check if user has any of the required permissions
    const requiredPermissionStrings = endpoint.requiredPermissions.map(
      (p) => `${p.resourceName}:${p.actionName}`,
    );

    const hasAccess = requiredPermissionStrings.some((perm) =>
      userPermissions.includes(perm),
    );

    // Cache the result
    this.cacheService.set(cacheKey, hasAccess, this.CACHE_TTL);

    return hasAccess;
  }

  /**
   * Get all permissions
   */
  async findAll(): Promise<Permission[]> {
    const cacheKey = 'permissions:all';

    // Check if permissions are in cache
    const cachedPermissions = this.cacheService.get<Permission[]>(cacheKey);
    if (cachedPermissions) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cachedPermissions;
    }

    // If not in cache, fetch from database
    this.logger.debug(`Cache miss for ${cacheKey}, fetching from database`);
    const permissions = await this.permissionRepository.find();

    // Store in cache
    this.cacheService.set(cacheKey, permissions, this.CACHE_TTL);

    return permissions;
  }

  /**
   * Get a permission by ID
   */
  async findOne(id: number): Promise<Permission> {
    const cacheKey = `permission:${id}`;

    // Check if permission is in cache
    const cachedPermission = this.cacheService.get<Permission>(cacheKey);
    if (cachedPermission) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cachedPermission;
    }

    // If not in cache, fetch from database
    this.logger.debug(`Cache miss for ${cacheKey}, fetching from database`);
    const permission = await this.permissionRepository.findOne({
      where: { id },
    });

    if (!permission) {
      throw new NotFoundException(`Permission with ID ${id} not found`);
    }

    // Store in cache
    this.cacheService.set(cacheKey, permission, this.CACHE_TTL);

    return permission;
  }

  /**
   * Get a permission by ID (alias for findOne for backward compatibility)
   */
  async findById(id: number): Promise<Permission> {
    return this.findOne(id);
  }

  /**
   * Get permissions by name
   */
  async findByName(name: string): Promise<Permission> {
    const cacheKey = `permission:name:${name}`;

    // Check if permission is in cache
    const cachedPermission = this.cacheService.get<Permission>(cacheKey);
    if (cachedPermission) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cachedPermission;
    }

    // If not in cache, fetch from database
    this.logger.debug(`Cache miss for ${cacheKey}, fetching from database`);
    const permission = await this.permissionRepository.findOne({
      where: { name },
    });

    if (!permission) {
      throw new NotFoundException(`Permission with name ${name} not found`);
    }

    // Store in cache
    this.cacheService.set(cacheKey, permission, this.CACHE_TTL);

    return permission;
  }

  /**
   * Create a new permission
   */
  async create(createPermissionDto: Partial<Permission>): Promise<Permission> {
    // Make sure name follows the format 'resource:action'
    if (createPermissionDto.name) {
      const [resourceName, actionName] = createPermissionDto.name.split(':');
      if (resourceName && actionName) {
        createPermissionDto.resourceName = resourceName;
        // Find or create the Action entity
        let action = await this.actionRepository.findOne({
          where: { name: actionName },
        });
        if (!action) {
          action = await this.actionRepository.save({
            name: actionName,
            actionCode: actionName,
            description: `${actionName} action`,
          });
        }
        createPermissionDto.actionId = action.id;
      }
    }

    const permission = this.permissionRepository.create(createPermissionDto);
    await this.permissionRepository.save(permission);

    // Invalidate caches
    this.cacheService.delete(`permissions:resource:${permission.resourceName}`);
    this.cacheService.delete(`permissions:action:${permission.actionName}`);
    this.cacheService.delete('permissions:all');

    return permission;
  }

  /**
   * Update a permission
   */
  async update(
    id: number,
    updatePermissionDto: Partial<Permission>,
  ): Promise<Permission> {
    const permission = await this.findById(id);

    // Update the permission
    Object.assign(permission, updatePermissionDto);

    // If name is provided and follows the format 'resource:action', update resourceName and actionId
    if (updatePermissionDto.name) {
      const [resourceName, actionName] = updatePermissionDto.name.split(':');
      if (resourceName && actionName) {
        permission.resourceName = resourceName;
        // Find or create the Action entity
        let action = await this.actionRepository.findOne({
          where: { name: actionName },
        });
        if (!action) {
          action = await this.actionRepository.save({
            name: actionName,
            actionCode: actionName,
            description: `${actionName} action`,
          });
        }
        permission.actionId = action.id;
      }
    }

    await this.permissionRepository.save(permission);

    // Invalidate caches
    this.cacheService.delete(`permissions:id:${id}`);
    this.cacheService.delete(`permissions:resource:${permission.resourceName}`);

    // Check if action has been changed
    if (updatePermissionDto.name) {
      this.cacheService.delete(`permissions:action:${permission.actionName}`);
    }

    this.cacheService.delete('permissions:all');

    return permission;
  }

  /**
   * Delete a permission
   */
  async delete(id: number): Promise<boolean> {
    const permission = await this.findById(id);

    // Invalidate caches before deletion
    this.cacheService.delete(`permissions:id:${id}`);
    this.cacheService.delete(`permissions:resource:${permission.resourceName}`);
    this.cacheService.delete(`permissions:action:${permission.actionName}`);
    this.cacheService.delete('permissions:all');

    await this.permissionRepository.delete(id);
    return true;
  }

  /**
   * Check if a permission exists
   */
  async exists(name: string): Promise<boolean> {
    const cacheKey = `permission:exists:${name}`;

    // Check if result is in cache
    const cachedResult = this.cacheService.get<boolean>(cacheKey);
    if (cachedResult !== undefined) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cachedResult;
    }

    // If not in cache, check in database
    this.logger.debug(`Cache miss for ${cacheKey}, checking database`);
    const count = await this.permissionRepository.count({ where: { name } });

    const exists = count > 0;

    // Store in cache
    this.cacheService.set(cacheKey, exists, this.CACHE_TTL);

    return exists;
  }

  /**
   * Get permissions by resource
   */
  async findByResource(resourceName: string): Promise<Permission[]> {
    const cacheKey = `permissions:resource:${resourceName}`;
    const cached = await this.cacheService.get<Permission[]>(cacheKey);

    if (cached) {
      this.logger.debug(
        `Retrieved ${cached.length} permissions for resource ${resourceName} from cache`,
      );
      return cached;
    }

    // Use the raw query to avoid column mismatch issues
    const query = `
      SELECT p.*, a.name as action_name FROM permissions p
      JOIN actions a ON p.action_id = a.id
      WHERE p.resource_name = ?
    `;

    const permissions = await this.entityManager.query(query, [resourceName]);

    // Map raw results to Permission entities
    const mappedPermissions = permissions.map((p) => {
      const permission = new Permission();
      permission.id = p.id;
      permission.name = p.name;
      permission.description = p.description;
      permission.resourceName = p.resource_name;
      permission.actionId = p.action_id;
      permission.createdAt = p.created_at;
      permission.updatedAt = p.updated_at;
      return permission;
    });

    await this.cacheService.set(cacheKey, mappedPermissions, this.CACHE_TTL);
    this.logger.debug(
      `Retrieved ${mappedPermissions.length} permissions for resource ${resourceName} from database`,
    );

    return mappedPermissions;
  }

  /**
   * Get permissions by action
   */
  async findByAction(actionName: string): Promise<Permission[]> {
    const cacheKey = `permissions:action:${actionName}`;
    const cached = await this.cacheService.get<Permission[]>(cacheKey);

    if (cached) {
      this.logger.debug(
        `Retrieved ${cached.length} permissions for action ${actionName} from cache`,
      );
      return cached;
    }

    // Use the raw query to find permissions by action name through the actions table
    const query = `
      SELECT p.*, a.name as action_name FROM permissions p
      JOIN actions a ON p.action_id = a.id
      WHERE a.name = ?
    `;

    const permissions = await this.entityManager.query(query, [actionName]);

    // Map raw results to Permission entities
    const mappedPermissions = permissions.map((p) => {
      const permission = new Permission();
      permission.id = p.id;
      permission.name = p.name;
      permission.description = p.description;
      permission.resourceName = p.resource_name;
      permission.actionId = p.action_id;
      permission.createdAt = p.created_at;
      permission.updatedAt = p.updated_at;
      return permission;
    });

    await this.cacheService.set(cacheKey, mappedPermissions, this.CACHE_TTL);
    this.logger.debug(
      `Retrieved ${mappedPermissions.length} permissions for action ${actionName} from database`,
    );

    return mappedPermissions;
  }

  /**
   * Check if a user has a specific permission
   */
  async checkUserPermission(
    userId: number,
    resourceName: string,
    actionName: string,
  ): Promise<boolean> {
    const cacheKey = `user:${userId}:permission:${resourceName}:${actionName}`;

    // Check cache first
    const cachedResult = await this.cacheService.get<boolean>(cacheKey);
    if (cachedResult !== undefined) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cachedResult;
    }

    // Get user's permissions
    const userPermissions = await this.getUserPermissionsSafe(userId);

    // Check if the exact permission exists
    const permissionName = `${resourceName}:${actionName}`;
    const hasPermission = userPermissions.includes(permissionName);

    // Store result in cache
    await this.cacheService.set(cacheKey, hasPermission, this.CACHE_TTL);

    return hasPermission;
  }

  /**
   * Get the role name for a user (for compatibility with old code)
   * @deprecated Use getRoleNamesForUser instead
   */
  getUserRoleName(user: User): string {
    if (!user || !user.roles || user.roles.length === 0) {
      return '';
    }

    // Return the name of the first role (for backward compatibility)
    return user.roles[0].name;
  }

  /**
   * Get all role names for a user
   */
  getRoleNamesForUser(user: User): string[] {
    if (!user || !user.roles || user.roles.length === 0) {
      return [];
    }

    return user.roles.map((role) => role.name);
  }

  /**
   * Get the primary role ID for a user (for compatibility with old code)
   * @deprecated Use getRoleIdsForUser instead
   */
  getUserRoleId(user: User): string {
    if (!user || !user.roles || user.roles.length === 0) {
      return '';
    }

    // Return the ID of the first role (for backward compatibility)
    return String(user.roles[0].id);
  }

  /**
   * Get all role IDs for a user
   */
  getRoleIdsForUser(user: User): string[] {
    if (!user || !user.roles || user.roles.length === 0) {
      return [];
    }

    return user.roles.map((role) => String(role.id));
  }

  /**
   * Ensure a permission exists, creating it if needed
   */
  async ensurePermissionExists(
    resourceName: string,
    actionName: string,
  ): Promise<Permission> {
    // First find the action
    let action = await this.actionRepository.findOne({
      where: { name: actionName },
    });

    if (!action) {
      action = await this.actionRepository.save({
        name: actionName,
        actionCode: actionName,
        description: `${actionName} action`,
      });
    }

    // Then check if permission already exists
    let permission = await this.permissionRepository.findOne({
      where: { resourceName, actionId: action.id },
      relations: ['actionEntity'],
    });

    if (!permission) {
      this.logger.log(
        `Permission ${resourceName}:${actionName} not found, creating it`,
      );
      permission = this.permissionRepository.create({
        resourceName,
        actionId: action.id,
        name: `${resourceName}:${actionName}`,
        description: `Permission to ${actionName} ${resourceName}`,
      });

      permission = await this.permissionRepository.save(permission);
      this.logger.debug(`Created permission: ${resourceName}:${actionName}`);
    }

    // Invalidate caches
    this.cacheService.delete(`permissions:resource:${resourceName}`);
    this.cacheService.delete(`permissions:action:${actionName}`);
    this.cacheService.delete('permissions:all');

    return permission;
  }

  /**
   * Assign permissions to a role
   */
  async assignPermissionsToRole(
    roleId: number,
    permissionStrings: string[],
  ): Promise<void> {
    this.logger.debug(
      `Assigning permissions to role ${roleId}: ${permissionStrings.join(', ')}`,
    );

    // Get role with existing permissions
    const role = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Process each permission string
    for (const permString of permissionStrings) {
      // Parse the permission string to get resource and action
      const parts = permString.split(':');
      if (parts.length !== 2) {
        this.logger.warn(`Invalid permission format: ${permString}, skipping`);
        continue;
      }

      const [resourceName, actionName] = parts;

      // Get or create the permission
      const permission = await this.ensurePermissionExists(
        resourceName,
        actionName,
      );

      // Check if role already has this permission
      const hasPermission = role.rolePermissions.some(
        (rp) =>
          rp.permission.resourceName === permission.resourceName &&
          rp.permission.actionName === permission.actionName,
      );

      if (!hasPermission) {
        // Create role permission relationship
        const rolePermission = this.rolePermissionRepository.create({
          role,
          permission,
          isGranted: true,
        });

        await this.rolePermissionRepository.save(rolePermission);
        this.logger.debug(
          `Assigned permission ${permString} to role ${role.name} (${roleId})`,
        );
      }
    }

    // Invalidate any cached permissions
    await this.cacheService.clearAllPermissions();
  }

  /**
   * Get permissions for a role
   */
  async getRolePermissions(roleId: number): Promise<any> {
    this.logger.debug(`Getting permissions for role ${roleId}`);

    // Get role with permissions
    const role = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Transform role permissions into a more usable format
    const permissions = role.rolePermissions.map((rp) => ({
      id: rp.permission.id,
      name: rp.permission.name,
      resourceName: rp.permission.resourceName,
      actionName: rp.permission.actionName,
      description: rp.permission.description,
      granted: rp.isGranted,
    }));

    return permissions;
  }

  /**
   * Update a role permission
   */
  async updateRolePermission(
    roleId: number,
    permissionId: number,
    granted: boolean,
  ): Promise<any> {
    this.logger.debug(
      `Updating permission ${permissionId} for role ${roleId}, granted: ${granted}`,
    );

    // Find role and permission
    const [role, permission] = await Promise.all([
      this.roleRepository.findOne({ where: { id: roleId } }),
      this.permissionRepository.findOne({ where: { id: permissionId } }),
    ]);

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (!permission) {
      throw new NotFoundException(
        `Permission with ID ${permissionId} not found`,
      );
    }

    // Find existing role permission or create new one
    let rolePermission = await this.rolePermissionRepository.findOne({
      where: {
        roleId: role.id,
        permissionId: permission.id,
      },
      relations: ['role', 'permission'],
    });

    if (rolePermission) {
      // Update existing
      rolePermission.isGranted = granted;
    } else {
      // Create new
      rolePermission = this.rolePermissionRepository.create({
        roleId: role.id,
        permissionId: permission.id,
        isGranted: granted,
      });
    }

    // Save the role permission
    await this.rolePermissionRepository.save(rolePermission);

    // Invalidate cached permissions
    await this.cacheService.clearAllPermissions();

    return { success: true };
  }

  /**
   * Get all permissions for a group
   */
  async getGroupPermissions(groupId: number | string): Promise<any[]> {
    // Convert string id to number if needed
    const numericGroupId =
      typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;

    const group = await this.groupRepository.findOne({
      where: { id: numericGroupId },
      relations: ['groupPermissions', 'groupPermissions.permission'],
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    const permissions = group.groupPermissions.map((gp) => ({
      id: gp.permission.id,
      name: gp.permission.name,
      resourceName: gp.permission.resourceName,
      actionName: gp.permission.actionName,
      granted: gp.isGranted,
    }));

    return permissions;
  }

  /**
   * Update a group permission
   */
  async updateGroupPermission(
    groupId: number,
    permissionId: number,
    granted: boolean,
  ): Promise<any> {
    // Check if group exists
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    // Check if permission exists
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
    });

    if (!permission) {
      throw new NotFoundException(
        `Permission with ID ${permissionId} not found`,
      );
    }

    // Check if the relation already exists
    let groupPermission = await this.groupPermissionRepository.findOne({
      where: {
        groupId,
        permissionId,
      },
    });

    if (groupPermission) {
      // Update existing relation
      groupPermission.isGranted = granted;
      await this.groupPermissionRepository.save(groupPermission);
    } else {
      // Create new relation
      groupPermission = this.groupPermissionRepository.create({
        group,
        permission,
        isGranted: granted,
      });
      await this.groupPermissionRepository.save(groupPermission);
    }

    return {
      groupId,
      permissionId,
      granted,
    };
  }

  /**
   * Get user direct permissions (not including role or group permissions)
   */
  async getUserDirectPermissions(userId: number): Promise<any> {
    this.logger.debug(`Getting direct permissions for user ${userId}`);

    // Get user with permissions
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['userPermissions', 'userPermissions.permission'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Transform user permissions into a more usable format
    const permissions = user.userPermissions.map((up) => ({
      id: up.permission.id,
      name: up.permission.name,
      resourceName: up.permission.resourceName,
      actionName: up.permission.actionName,
      description: up.permission.description,
      granted: up.isGranted,
    }));

    return permissions;
  }

  /**
   * Update a user permission
   */
  async updateUserPermission(
    userId: number,
    permissionId: number,
    granted: boolean,
  ): Promise<any> {
    this.logger.debug(
      `Updating permission ${permissionId} for user ${userId}, granted: ${granted}`,
    );

    // Find user and permission
    const [user, permission] = await Promise.all([
      this.userRepository.findOne({ where: { id: userId } }),
      this.permissionRepository.findOne({ where: { id: permissionId } }),
    ]);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!permission) {
      throw new NotFoundException(
        `Permission with ID ${permissionId} not found`,
      );
    }

    // Find existing user permission or create new one
    let userPermission = await this.userPermissionRepository.findOne({
      where: {
        user: { id: userId },
        permission: { id: permissionId },
      } as any, // Type assertion needed due to TypeORM limitations
      relations: ['user', 'permission'],
    });

    if (userPermission) {
      // Update existing
      userPermission.isGranted = granted;
    } else {
      // Create new
      userPermission = this.userPermissionRepository.create({
        user,
        permission,
        isGranted: granted,
      });
    }

    // Save the user permission
    await this.userPermissionRepository.save(userPermission);

    // Invalidate cached permissions
    await this.cacheService.clearUserPermissions(userId);

    return { success: true };
  }

  /**
   * Get all resource names
   */
  async findAllResources(): Promise<string[]> {
    const cacheKey = 'resources:all';

    // Check if resources are in cache
    const cachedResources = this.cacheService.get<string[]>(cacheKey);
    if (cachedResources) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cachedResources;
    }

    // If not in cache, fetch from database
    this.logger.debug(`Cache miss for ${cacheKey}, fetching from database`);
    const resources = await this.resourceRepository.find();
    const resourceNames = resources.map((r) => r.name);

    // Store in cache
    this.cacheService.set(cacheKey, resourceNames, this.CACHE_TTL);

    return resourceNames;
  }

  /**
   * Get user permissions safely (with fallback)
   */
  async getUserPermissionsSafe(userId: number): Promise<string[]> {
    try {
      return await this.getUserPermissions(userId);
    } catch (error) {
      this.logger.warn(
        `Failed to get permissions for user ${userId}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Seed default permissions
   */
  async seedDefaultPermissions(): Promise<void> {
    this.logger.log('Seeding default permissions...');

    // Define default permissions
    const defaultPermissions = [
      { resource: 'users', action: 'read' },
      { resource: 'users', action: 'create' },
      { resource: 'users', action: 'update' },
      { resource: 'users', action: 'delete' },
      { resource: 'roles', action: 'read' },
      { resource: 'roles', action: 'create' },
      { resource: 'roles', action: 'update' },
      { resource: 'roles', action: 'delete' },
      { resource: 'permissions', action: 'read' },
      { resource: 'permissions', action: 'update' },
      { resource: 'dashboard', action: 'read' },
    ];

    for (const { resource, action } of defaultPermissions) {
      await this.ensurePermissionExists(resource, action);
    }

    this.logger.log('Default permissions seeded successfully');
  }

  /**
   * Create a new action
   */
  async createAction(createActionDto: CreateActionDto): Promise<Action> {
    const action = this.actionRepository.create(createActionDto);
    return await this.actionRepository.save(action);
  }

  /**
   * Update an action
   */
  async updateAction(
    id: number,
    updateActionDto: UpdateActionDto,
  ): Promise<Action> {
    const action = await this.actionRepository.findOne({ where: { id } });
    if (!action) {
      throw new NotFoundException(`Action with ID ${id} not found`);
    }

    Object.assign(action, updateActionDto);
    return await this.actionRepository.save(action);
  }

  /**
   * Get action by ID
   */
  async getActionById(id: number): Promise<Action> {
    const action = await this.actionRepository.findOne({ where: { id } });
    if (!action) {
      throw new NotFoundException(`Action with ID ${id} not found`);
    }
    return action;
  }

  /**
   * Get all actions
   */
  async getAllActions(): Promise<Action[]> {
    return await this.actionRepository.find();
  }

  /**
   * Create a new resource
   */
  async createResource(
    createResourceDto: UpdateResourceDto,
  ): Promise<Resource> {
    const resource = this.resourceRepository.create(createResourceDto);
    return await this.resourceRepository.save(resource);
  }

  /**
   * Update a resource
   */
  async updateResource(
    id: number,
    updateResourceDto: UpdateResourceDto,
  ): Promise<Resource> {
    const resource = await this.resourceRepository.findOne({ where: { id } });
    if (!resource) {
      throw new NotFoundException(`Resource with ID ${id} not found`);
    }

    Object.assign(resource, updateResourceDto);
    return await this.resourceRepository.save(resource);
  }

  /**
   * Get resource by ID
   */
  async getResourceById(id: number): Promise<Resource> {
    const resource = await this.resourceRepository.findOne({ where: { id } });
    if (!resource) {
      throw new NotFoundException(`Resource with ID ${id} not found`);
    }
    return resource;
  }

  /**
   * Get all resources
   */
  async getAllResources(): Promise<Resource[]> {
    return await this.resourceRepository.find();
  }

  /**
   * Sync permissions from manifest
   */
  async syncPermissionsFromManifest(): Promise<void> {
    this.logger.log('Syncing permissions from manifest...');
    // This method would sync permissions from a manifest file
    // For now, just log that it's called
    this.logger.log('Manifest sync completed');
  }

  /**
   * Get current user permissions (for compatibility)
   */
  async getCurrentUserPermissions(userId: number): Promise<string[]> {
    return await this.getUserPermissions(userId);
  }

  /**
   * Get user roles (for compatibility)
   */
  async getUserRoles(userId: number): Promise<Role[]> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user.roles || [];
  }

  /**
   * Find all actions with optional search
   */
  async findAllActions(search?: string): Promise<Action[]> {
    if (search) {
      return await this.actionRepository.find({
        where: [
          { name: Like(`%${search}%`) },
          { description: Like(`%${search}%`) },
        ],
      });
    }
    return await this.actionRepository.find();
  }

  /**
   * Find action by ID
   */
  async findActionById(id: number): Promise<Action> {
    const action = await this.actionRepository.findOne({ where: { id } });
    if (!action) {
      throw new NotFoundException(`Action with ID ${id} not found`);
    }
    return action;
  }

  /**
   * Remove an action
   */
  async removeAction(id: number): Promise<void> {
    const action = await this.findActionById(id);
    await this.actionRepository.remove(action);
  }

  /**
   * Delete a resource
   */
  async deleteResource(id: number): Promise<void> {
    const resource = await this.getResourceById(id);
    await this.resourceRepository.remove(resource);
  }

  /**
   * Find permissions by role
   */
  async findByRole(roleId: number): Promise<Permission[]> {
    const role = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: [
        'rolePermissions',
        'rolePermissions.permission',
        'rolePermissions.permission.actionEntity',
      ],
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    return role.rolePermissions
      .filter((rp) => rp.isGranted)
      .map((rp) => rp.permission);
  }

  /**
   * Find permissions by group
   */
  async findByGroup(groupId: number): Promise<Permission[]> {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: [
        'groupPermissions',
        'groupPermissions.permission',
        'groupPermissions.permission.actionEntity',
      ],
    });

    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }

    return group.groupPermissions
      .filter((gp) => gp.isGranted)
      .map((gp) => gp.permission);
  }
}
