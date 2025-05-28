import { SetMetadata } from '@nestjs/common';
import { SystemRoles } from '../../users/entities/role.entity';
import { PERMISSIONS_KEY } from '../../permissions/guards/permission.guard';

export const ROLES_KEY = 'roles';

/**
 * Legacy Roles decorator - kept for backward compatibility
 * @deprecated Use RequirePermission instead
 */
export const Roles = (...roles: string[]) => {
  console.warn(
    'DEPRECATED: @Roles decorator is deprecated. Use @RequirePermission instead. ' +
      `Called with roles: [${roles.join(', ')}]`,
  );

  // Convert roles to role-based permissions for compatibility
  const permissions = roles.map((role) => `role:${role}`);

  // Set both the old metadata and the new permission metadata
  return (target: any, key?: string, descriptor?: any) => {
    SetMetadata(ROLES_KEY, roles)(target, key, descriptor);
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key, descriptor);
  };
};

/**
 * Helper method to provide type-safe access to system roles
 * @deprecated Use resource-action permissions instead of roles
 */
export const HasSystemRole = (role: string) => {
  console.warn(
    'DEPRECATED: HasSystemRole is deprecated. Use RequirePermission instead. ' +
      `Called with role: ${role}`,
  );
  return `role:${role}`;
};
