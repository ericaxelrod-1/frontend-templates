import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { SystemRoles } from '../../users/entities/role.entity';
import { PermissionsService } from '../../permissions/services/permissions.service';
import { Logger } from '@nestjs/common';

/**
 * Legacy role guard - kept for backward compatibility
 * @deprecated Use PermissionGuard instead
 */
@Injectable()
export class RoleGuard implements CanActivate {
  private readonly logger = new Logger(RoleGuard.name);

  constructor(
    private reflector: Reflector,
    private usersService: UsersService,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required roles from the decorator
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get the user from the request
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If no user is found, deny access
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Log the deprecation warning
    this.logger.warn(
      'DEPRECATED: RoleGuard is deprecated. Use PermissionGuard instead. ' +
        `Called with roles: [${requiredRoles.join(', ')}]`,
    );

    try {
      // Check if the user has permissions through the new permission system
      // Convert roles to permission format
      const rolePermissions = requiredRoles.map((role) => `role:${role}`);

      // Get all user permissions
      const userPermissions = await this.permissionsService.getUserPermissions(
        user.id,
      );

      // Check if user has any of the required permissions
      const hasPermission = rolePermissions.some((permission) =>
        userPermissions.includes(permission),
      );

      if (hasPermission) {
        return true;
      }

      throw new ForbiddenException(
        'Access denied. Required permissions not found.',
      );
    } catch (error) {
      this.logger.error(`Permission check failed: ${error.message}`);
      throw new ForbiddenException('Error checking permissions');
    }
  }
}
