import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router
} from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { Store } from '@ngxs/store';
import { AuthState } from '../../store/auth/auth.state';
import { PermissionService } from '../services/permission.service';
import { map, take, filter } from 'rxjs/operators';
import { User } from '../../models/user.model';

// Define permission rule interfaces
export type PermissionRule = string | string[] | { all: string[] };

/**
 * Guard that protects routes based on permissions
 * Supports multiple formats:
 * - Single permission: 'users:read'
 * - Any permission: ['users:read', 'users:admin']
 * - All permissions: { all: ['users:read', 'settings:view'] }
 */
@Injectable({
  providedIn: 'root'
})
export class PermissionGuard implements CanActivate {
  
  constructor(
    private authService: AuthService,
    private router: Router,
    private store: Store,
    private permissionService: PermissionService
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    // Get the current user and authentication status
    const isAuthenticated = this.store.selectSnapshot(AuthState.isAuthenticated);
    const currentUser = this.store.selectSnapshot(AuthState.user) as User | null;
    const permissionsLoaded = this.store.selectSnapshot(AuthState.permissionsLoaded);
    
    console.log('[PermissionGuard] Current user:', currentUser?.email);
    console.log('[PermissionGuard] Permissions loaded:', permissionsLoaded);
    
    // Redirect to login if not authenticated
    if (!isAuthenticated || !currentUser) {
      console.log('[PermissionGuard] User not authenticated, redirecting to login');
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    // Check for permission rules in route data
    const permissionRule = route.data['permissions'] as PermissionRule;
    if (!permissionRule) {
      console.log('[PermissionGuard] No permission rule defined, denying access');
      this.router.navigate(['/app/dashboard']);
      return false;
    }
    
    console.log('[PermissionGuard] Checking permission rule:', permissionRule);
    
    // If permissions aren't loaded yet, wait for them
    if (!permissionsLoaded) {
      console.log('[PermissionGuard] Permissions not loaded yet, waiting...');
      
      // Return an observable that completes when permissions are loaded
      return this.store.select(AuthState.permissionsLoaded).pipe(
        filter(loaded => loaded),
        take(1),
        map(() => this.checkPermissions(permissionRule))
      );
    }
    
    // If permissions are already loaded, check them synchronously
    return this.checkPermissions(permissionRule);
  }
  
  /**
   * Check if the user has the required permissions
   * @param permissionRule The permission rule to check
   * @returns Boolean indicating if user has required permissions
   */
  private checkPermissions(permissionRule: PermissionRule): boolean {
    const hasPermission = this.store.selectSnapshot(AuthState.hasPermission);
    const hasAnyPermission = this.store.selectSnapshot(AuthState.hasAnyPermission);
    const hasAllPermissions = this.store.selectSnapshot(AuthState.hasAllPermissions);
    
    // Handle different permission rule formats
    if (typeof permissionRule === 'string') {
      // Single permission string (e.g., 'users:manage')
      const result = hasPermission(permissionRule);
      if (!result) {
        console.log('[PermissionGuard] Permission denied:', permissionRule);
        this.router.navigate(['/app/dashboard']);
      }
      return result;
    } 
    else if (Array.isArray(permissionRule)) {
      // Array of permissions (any of them)
      const result = hasAnyPermission(permissionRule);
      if (!result) {
        console.log('[PermissionGuard] No matching permissions in:', permissionRule);
        this.router.navigate(['/app/dashboard']);
      }
      return result;
    }
    else if (permissionRule.all && Array.isArray(permissionRule.all)) {
      // Object with 'all' property for requiring all permissions
      const result = hasAllPermissions(permissionRule.all);
      if (!result) {
        console.log('[PermissionGuard] Missing required permissions from:', permissionRule.all);
        this.router.navigate(['/app/dashboard']);
      }
      return result;
    }
    
    // If we get here, the permission rule format is invalid
    console.log('[PermissionGuard] Invalid permission rule format, denying access');
    this.router.navigate(['/app/dashboard']);
    return false;
  }
} 