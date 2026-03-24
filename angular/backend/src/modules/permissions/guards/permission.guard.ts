import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../services/permissions.service';

export const PERMISSIONS_KEY = 'require_permission';

export interface Permission {
  resource: string;
  action: string;
}

/**
 * Guard that checks if the user has the required permissions for a route
 * Works with the RequirePermission decorator
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required permissions from handler metadata
    const requiredPermissions = this.getRequiredPermissions(context);

    // If no permissions are required, allow access
    if (!requiredPermissions) {
      return true;
    }

    // Check if requiredPermissions is an array and it's empty
    if (
      Array.isArray(requiredPermissions) &&
      requiredPermissions.length === 0
    ) {
      return true;
    }

    // Get the user from the request
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If no user is authenticated, deny access
    if (!user) {
      throw new UnauthorizedException(
        'You must be logged in to access this resource',
      );
    }

    this.logger.debug(
      `Checking permissions for user ${user.id}: ${JSON.stringify(requiredPermissions)}`,
    );

    // Check for special ALL permissions case
    if (
      typeof requiredPermissions === 'object' &&
      'all' in requiredPermissions
    ) {
      // User must have ALL permissions in the list
      const allPermissions = requiredPermissions.all as string[];

      if (allPermissions.length === 0) {
        return true;
      }

      for (const permission of allPermissions) {
        // Validate the permission format
        this.validatePermissionFormat(permission);

        const [resourceName, actionName] = permission.split(':');

        const hasPermission = await this.permissionsService.checkUserPermission(
          user.id,
          resourceName,
          actionName,
        );

        if (!hasPermission) {
          this.logger.debug(
            `User ${user.id} lacks required permission: ${permission}`,
          );
          throw new ForbiddenException(
            'You do not have all required permissions to access this resource',
          );
        }
      }

      // User has all required permissions
      return true;
    }

    // Standard case: User needs at least one of the permissions (OR logic)
    for (const permission of requiredPermissions) {
      // Validate the permission format
      this.validatePermissionFormat(permission);

      const [resourceName, actionName] = permission.split(':');

      const hasPermission = await this.permissionsService.checkUserPermission(
        user.id,
        resourceName,
        actionName,
      );

      if (hasPermission) {
        return true; // User has at least one of the required permissions
      }
    }

    // User doesn't have any of the required permissions
    this.logger.debug(
      `User ${user.id} lacks all required permissions: ${JSON.stringify(requiredPermissions)}`,
    );
    throw new ForbiddenException(
      'You do not have permission to access this resource',
    );
  }

  /**
   * Validate that a permission string follows the correct format
   */
  private validatePermissionFormat(permission: string): void {
    if (!permission.includes(':')) {
      this.logger.error(
        `Invalid permission format: ${permission}. Expected 'resource:action'`,
      );
      throw new BadRequestException(
        `Invalid permission format: ${permission}. Expected 'resource:action'`,
      );
    }

    const [resourceName, actionName] = permission.split(':');

    if (!resourceName || !actionName) {
      this.logger.error(
        `Invalid permission format: ${permission}. Expected 'resource:action'`,
      );
      throw new BadRequestException(
        `Invalid permission format: ${permission}. Expected 'resource:action'`,
      );
    }

    // Reject any 'role:ROLENAME' format permissions
    if (resourceName === 'role') {
      this.logger.error(
        `Role-based permissions are no longer supported: ${permission}`,
      );
      throw new BadRequestException(
        `Role-based permissions are no longer supported: ${permission}`,
      );
    }
  }

  /**
   * Get the required permissions from handler and controller metadata
   */
  private getRequiredPermissions(
    context: ExecutionContext,
  ): string[] | { all: string[] } | null {
    // Get permissions from handler and controller
    const handlerPermissions = this.reflector.get<
      string | string[] | { all: string[] }
    >(PERMISSIONS_KEY, context.getHandler());

    const controllerPermissions = this.reflector.get<
      string | string[] | { all: string[] }
    >(PERMISSIONS_KEY, context.getClass());

    // If no permissions defined anywhere, return null
    if (!handlerPermissions && !controllerPermissions) {
      return null;
    }

    // Handle special 'all' case first
    if (
      (typeof handlerPermissions === 'object' &&
        !Array.isArray(handlerPermissions) &&
        'all' in handlerPermissions) ||
      (typeof controllerPermissions === 'object' &&
        !Array.isArray(controllerPermissions) &&
        'all' in controllerPermissions)
    ) {
      // If either has 'all', return that (handler takes precedence)
      if (
        typeof handlerPermissions === 'object' &&
        !Array.isArray(handlerPermissions) &&
        'all' in handlerPermissions
      ) {
        return handlerPermissions;
      }
      return controllerPermissions as { all: string[] };
    }

    // Standard case: combine permissions with OR logic
    const permissions: string[] = [];

    // Add handler permissions
    if (handlerPermissions) {
      if (Array.isArray(handlerPermissions)) {
        permissions.push(...handlerPermissions);
      } else if (typeof handlerPermissions === 'string') {
        permissions.push(handlerPermissions);
      }
    }

    // Add controller permissions
    if (controllerPermissions) {
      if (Array.isArray(controllerPermissions)) {
        permissions.push(...controllerPermissions);
      } else if (typeof controllerPermissions === 'string') {
        permissions.push(controllerPermissions);
      }
    }

    return permissions;
  }
}
