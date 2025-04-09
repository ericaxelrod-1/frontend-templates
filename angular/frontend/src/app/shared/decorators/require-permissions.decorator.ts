/**
 * Decorator to mark a component as requiring specific permissions.
 * This is used by the backend scanner to discover component permission requirements.
 * 
 * @param permissions List of required permissions (in the format 'resource:action')
 * @returns Component decorator
 */
export function RequirePermissions(permissions: string | string[]) {
  return function (target: any) {
    // Store permissions on the component class for runtime checks
    const permList = Array.isArray(permissions) ? permissions : [permissions];
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