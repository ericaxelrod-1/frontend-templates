import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { Observable, map, of } from 'rxjs';
import { User } from '../../models';

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  constructor(private authService: AuthService) { }

  /**
   * Check if the current user has any of the required roles
   * This is the centralized method for checking permissions across the application
   * @param requiredRoles Array of roles to check
   * @returns True if the user has at least one of the required roles
   */
  hasPermission(requiredRoles: string[]): boolean {
    console.log('[PermissionService] Checking for roles:', requiredRoles);
    
    // If no roles required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      console.log('[PermissionService] No roles required, allowing access');
      return true;
    }
    
    const currentUser = this.authService.currentUser;
    console.log('[PermissionService] Current user:', currentUser);
    
    // No user means no permission
    if (!currentUser) {
      console.log('[PermissionService] No current user, denying access');
      return false;
    }
    
    // Special case for admin@example.com - always grant access
    if (currentUser.email === 'admin@example.com') {
      console.log('[PermissionService] Admin user detected, granting access');
      return true;
    }
    
    // Check if the user has any of the required roles
    const hasRequiredRole = requiredRoles.some(role => this.authService.hasRole(role));
    console.log('[PermissionService] Has required role:', hasRequiredRole);
    
    return hasRequiredRole;
  }
  
  /**
   * Observable version of hasPermission for reactive components
   * @param requiredRoles Array of roles to check
   * @returns Observable that emits true if the user has at least one of the required roles
   */
  hasPermission$(requiredRoles: string[]): Observable<boolean> {
    return this.authService.currentUser$.pipe(
      map(user => {
        console.log('[PermissionService$] Checking for roles:', requiredRoles, 'for user:', user);
        
        // If no roles required, allow access
        if (!requiredRoles || requiredRoles.length === 0) {
          console.log('[PermissionService$] No roles required, allowing access');
          return true;
        }
        
        // No user means no permission
        if (!user) {
          console.log('[PermissionService$] No current user, denying access');
          return false;
        }
        
        // Special case for admin@example.com - always grant access
        if (user.email === 'admin@example.com') {
          console.log('[PermissionService$] Admin user detected, granting access');
          return true;
        }
        
        // Check if the user has any of the required roles
        const hasRequiredRole = requiredRoles.some(role => this.authService.hasRole(role));
        console.log('[PermissionService$] Has required role:', hasRequiredRole);
        
        return hasRequiredRole;
      })
    );
  }
} 