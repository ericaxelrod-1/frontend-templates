/**
 * Validates that a permission string follows the required format
 * @param permission The permission string to validate
 */
function validatePermissionFormat(permission: string): void {
  if (!permission.includes(':')) {
    throw new Error(`Invalid permission format: ${permission}. Use 'resource:action' format.`);
  }
  
  const [resource, action] = permission.split(':');
  
  if (!resource || !action) {
    throw new Error(`Invalid permission format: ${permission}. Use 'resource:action' format.`);
  }
  
  // Reject role:ROLENAME format
  if (resource === 'role') {
    throw new Error(`Role-based permissions are no longer supported: ${permission}`);
  }
}

/**
 * Decorator to mark a component as requiring specific permissions.
 * This is used by the backend scanner to discover component permission requirements.
 * 
 * @param permissions List of required permissions (in the format 'resource:action')
 * @returns Component decorator
 */
export function RequirePermissions(permissions: string | string[]) {
  return function (target: any) {
    // Validate permissions format
    const permList = Array.isArray(permissions) ? permissions : [permissions];
    
    // Validate and reject role:ROLENAME format
    permList.forEach(validatePermissionFormat);
    
    // Store permissions on the component class for runtime checks
    target.prototype.requiredPermissions = permList;
    
    // The decorator doesn't modify the component behavior,
    // it's used for static analysis by the backend scanner
    return target;
  };
}

/**
 * Short alias for RequirePermissions
 */
export const HasPermissions = RequirePermissions; 