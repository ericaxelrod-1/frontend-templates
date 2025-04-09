import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { Store } from '@ngxs/store';
import { AuthState } from '../../store/auth/auth.state';
import { PermissionService } from '../services/permission.service';
import { map, catchError } from 'rxjs/operators';
import { User } from '../../models/user.model';

/**
 * @deprecated Use PermissionGuard instead with 'permissions' route data
 * This guard is maintained for backward compatibility
 */
@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  
  constructor(
    private authService: AuthService,
    private router: Router,
    private store: Store,
    private permissionService: PermissionService
  ) {
    console.warn('RoleGuard is deprecated. Use PermissionGuard instead with permissions route data.');
  }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    // Get the current user
    const isAuthenticated = this.store.selectSnapshot(AuthState.isAuthenticated);
    const currentUser = this.store.selectSnapshot(AuthState.user) as User | null;
    
    // Redirect to login if not authenticated
    if (!isAuthenticated || !currentUser) {
      console.log('[RoleGuard] User not authenticated, redirecting to login');
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    // Check for role or permission rules (for backward compatibility)
    const requiredRoles = route.data['roles'] as string[] | undefined;
    const permissionRule = route.data['permissionRule'] as string | string[] | { all: string[] } | undefined;
    
    if (!requiredRoles && !permissionRule) {
      console.log('[RoleGuard] No roles or permissions defined, denying access');
      this.router.navigate(['/app/dashboard']);
      return false;
    }

    // Handle role-based rules (converted to permission-based internally)
    if (requiredRoles && requiredRoles.length > 0) {
      console.warn('Route using deprecated role-based security. Update to permission-based approach.');
      
      // Convert roles to 'role:rolename' format permissions
      const rolePermissions = requiredRoles.map(role => `role:${role.toLowerCase()}`);
      
      // Use the permission service to check
      return this.permissionService.hasAnyPermission(rolePermissions).pipe(
        map(hasPermission => {
          if (!hasPermission) {
            console.log('[RoleGuard] Role permission denied, redirecting to dashboard');
            this.router.navigate(['/app/dashboard']);
          }
          return hasPermission;
        }),
        catchError(() => {
          this.router.navigate(['/app/dashboard']);
          return of(false);
        })
      );
    }
    
    // Handle permission rules (exactly like PermissionGuard)
    if (typeof permissionRule === 'string') {
      return this.permissionService.hasPermission(permissionRule).pipe(
        map(hasPermission => {
          if (!hasPermission) {
            this.router.navigate(['/app/dashboard']);
          }
          return hasPermission;
        }),
        catchError(() => {
          this.router.navigate(['/app/dashboard']);
          return of(false);
        })
      );
    } 
    else if (Array.isArray(permissionRule)) {
      return this.permissionService.hasAnyPermission(permissionRule).pipe(
        map(hasAnyPermission => {
          if (!hasAnyPermission) {
            this.router.navigate(['/app/dashboard']);
          }
          return hasAnyPermission;
        }),
        catchError(() => {
          this.router.navigate(['/app/dashboard']);
          return of(false);
        })
      );
    }
    else if (permissionRule?.all && Array.isArray(permissionRule.all)) {
      return this.permissionService.hasAllPermissions(permissionRule.all).pipe(
        map(hasAllPermissions => {
          if (!hasAllPermissions) {
            this.router.navigate(['/app/dashboard']);
          }
          return hasAllPermissions;
        }),
        catchError(() => {
          this.router.navigate(['/app/dashboard']);
          return of(false);
        })
      );
    }
    
    // If we get here, the permission rule format is invalid
    console.log('[RoleGuard] Invalid permission rule format, denying access');
    this.router.navigate(['/app/dashboard']);
    return false;
  }
} 