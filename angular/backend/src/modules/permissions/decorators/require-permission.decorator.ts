import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../guards/permission.guard';

/**
 * Validates that a permission string follows the required format
 * @param permission The permission string to validate
 */
function validatePermissionFormat(permission: string): void {
  if (!permission.includes(':')) {
    throw new Error(
      `Invalid permission format: ${permission}. Use 'resource:action' format.`,
    );
  }

  const [resource, action] = permission.split(':');

  if (!resource || !action) {
    throw new Error(
      `Invalid permission format: ${permission}. Use 'resource:action' format.`,
    );
  }

  // Reject role:ROLENAME format
  if (resource === 'role') {
    throw new Error(
      `Role-based permissions are no longer supported: ${permission}`,
    );
  }
}

/**
 * Decorator to specify required permissions for an endpoint.
 * The user needs ANY of the specified permissions to access the endpoint.
 *
 * @param permissions String or array of permission strings in format 'resource:action'
 * @returns Decorator function
 *
 * @example
 * // Require a single permission
 * @RequirePermission('users:create')
 * createUser() { ... }
 *
 * @example
 * // Require ANY of multiple permissions (OR logic)
 * @RequirePermission(['users:update', 'users:manage'])
 * updateUser() { ... }
 */
export const RequirePermission = (permissions: string | string[]) => {
  // Validate permission format
  if (typeof permissions === 'string') {
    validatePermissionFormat(permissions);
  } else if (Array.isArray(permissions)) {
    permissions.forEach(validatePermissionFormat);
  }

  return SetMetadata(PERMISSIONS_KEY, permissions);
};

/**
 * Decorator to specify that ALL specified permissions are required.
 * The user must have EVERY permission listed to access the endpoint.
 *
 * @param permissions Array of permission strings in format 'resource:action'
 * @returns Decorator function
 *
 * @example
 * // Require ALL of these permissions (AND logic)
 * @RequireAllPermissions(['users:read', 'roles:read'])
 * getDetailedUserWithRoles() { ... }
 */
export const RequireAllPermissions = (permissions: string[]) => {
  // Validate permission format
  permissions.forEach(validatePermissionFormat);

  return SetMetadata(PERMISSIONS_KEY, { all: permissions });
};
