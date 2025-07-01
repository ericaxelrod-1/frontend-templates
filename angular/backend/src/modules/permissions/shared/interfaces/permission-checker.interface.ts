/**
 * Interface for permission checking functionality
 * This allows other modules to check permissions without circular dependencies
 */
export interface IPermissionChecker {
  /**
   * Check if a user has a specific permission
   * @param userId - The ID of the user to check
   * @param resourceName - The resource to check permissions for
   * @param actionName - The action to check permissions for
   * @returns True if the user has permission, false otherwise
   */
  checkUserPermission(
    userId: number,
    resourceName: string,
    actionName: string,
  ): Promise<boolean>;

  /**
   * Get all permissions for a user
   * @param userId - The ID of the user
   * @returns An array of permission strings in the format "resource:action"
   */
  getUserPermissions(userId: number): Promise<string[]>;
}
