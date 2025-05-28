import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './guards/permission.guard';
import { PermissionsService } from './services/permissions.service';

/**
 * Legacy guard class for backward compatibility
 * @deprecated Use PermissionGuard from guards/permission.guard instead
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger('LegacyPermissionGuard');

  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {
    this.logger.warn(
      'Using deprecated PermissionGuard, please update imports to use ./guards/permission.guard',
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required permissions from handler metadata
    const handlerPermissions = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getHandler(),
    );

    const controllerPermissions = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getClass(),
    );

    // If no permissions are required, allow access
    if (!handlerPermissions && !controllerPermissions) {
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

    // Combine permissions
    const permissions = [
      ...(Array.isArray(handlerPermissions) ? handlerPermissions : []),
      ...(Array.isArray(controllerPermissions) ? controllerPermissions : []),
    ];

    // Check each permission
    for (const permission of permissions) {
      const [resource, action] = permission.split(':');

      if (resource === 'role') {
        this.logger.error(
          `Role-based permissions are no longer supported: ${permission}`,
        );
        throw new BadRequestException(
          `Role-based permissions are no longer supported: ${permission}`,
        );
      }

      const hasPermission = await this.permissionsService.checkUserPermission(
        user.id,
        resource,
        action,
      );

      if (hasPermission) {
        return true;
      }
    }

    throw new UnauthorizedException(
      'You do not have permission to access this resource',
    );
  }
}
