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
 * Legacy decorator for permission requirements (kept for backward compatibility).
 * Uses the same format as RequirePermission but named to match older code.
 *
 * @deprecated Use RequirePermission instead.
 * @param permissions String or array of permission strings in format 'resource:action'
 * @returns Decorator function
 */
export const RequirePermissions = (permissions: string | string[]) => {
  // Validate permission format
  if (typeof permissions === 'string') {
    validatePermissionFormat(permissions);
  } else if (Array.isArray(permissions)) {
    permissions.forEach(validatePermissionFormat);
  }

  return SetMetadata(PERMISSIONS_KEY, permissions);
};
