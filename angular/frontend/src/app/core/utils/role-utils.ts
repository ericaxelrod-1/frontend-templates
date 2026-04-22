import { SystemRoles } from '../constants/roles';

/**
 * Utility functions for safely handling role operations
 */
export class RoleUtils {
  /**
   * Safely get a role value from SystemRoles
   * @param roleKey The key to look up in SystemRoles
   * @param defaultValue Optional default value if the key doesn't exist
   * @returns The role value or default value
   */
  static safeGetRole(roleKey: string | null | undefined, defaultValue = ''): string {
    if (!roleKey) {
      return defaultValue;
    }
    
    // Try to get by direct key
    if (Object.prototype.hasOwnProperty.call(SystemRoles, roleKey)) {
      return SystemRoles[roleKey];
    }
    
    // Try uppercase version
    const upperKey = this.safeToUpperCase(roleKey);
    if (upperKey && Object.prototype.hasOwnProperty.call(SystemRoles, upperKey)) {
      return SystemRoles[upperKey];
    }
    
    // Try lowercase version
    const lowerKey = this.safeToLowerCase(roleKey);
    if (lowerKey && Object.prototype.hasOwnProperty.call(SystemRoles, lowerKey)) {
      return SystemRoles[lowerKey];
    }
    
    // Return default if no match found
    console.warn(`RoleUtils: Role key "${roleKey}" not found in SystemRoles, using default value`);
    return defaultValue;
  }
  
  /**
   * Safely convert a string to uppercase
   * @param str The string to convert
   * @returns The uppercase string or empty string if input is null/undefined
   */
  static safeToUpperCase(str: string | null | undefined): string {
    return str ? str.toUpperCase() : '';
  }
  
  /**
   * Safely convert a string to lowercase
   * @param str The string to convert
   * @returns The lowercase string or empty string if input is null/undefined
   */
  static safeToLowerCase(str: string | null | undefined): string {
    return str ? str.toLowerCase() : '';
  }
  
  /**
   * Safely check if a user has a role
   * @param userRoles Array of role objects or strings
   * @param roleToCheck Role to check for
   * @param caseSensitive Whether to check case-sensitively (default: false)
   * @returns true if the user has the role, false otherwise
   */
  static hasRole(
    userRoles: ({ name: string } | string)[] | null | undefined,
    roleToCheck: string | null | undefined,
    caseSensitive = false
  ): boolean {
    if (!userRoles || !roleToCheck) {
      return false;
    }
    
    const roleToCheckValue = caseSensitive ? roleToCheck : this.safeToLowerCase(roleToCheck);
    
    return userRoles.some(role => {
      const roleName = typeof role === 'string' 
        ? role 
        : (role?.name || '');
        
      const normalizedRole = caseSensitive ? roleName : this.safeToLowerCase(roleName);
      return normalizedRole === roleToCheckValue;
    });
  }
  
  /**
   * Safely extract role names from an array of role objects
   * @param roles Array of role objects
   * @returns Array of role names
   */
  static extractRoleNames(roles: { name: string }[] | null | undefined): string[] {
    if (!roles || !Array.isArray(roles)) {
      return [];
    }
    
    return roles
      .filter(role => role && typeof role.name === 'string')
      .map(role => role.name);
  }
  
  /**
   * Format a list of roles as a comma-separated string
   * @param roles Array of role objects or strings
   * @returns Comma-separated string of role names
   */
  static formatRoleNames(roles: ({ name: string } | string)[] | null | undefined): string {
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return '';
    }
    
    const roleNames = roles.map(role => {
      if (typeof role === 'string') {
        return role;
      }
      return role?.name || '';
    }).filter(name => name);
    
    return roleNames.join(', ');
  }
} 