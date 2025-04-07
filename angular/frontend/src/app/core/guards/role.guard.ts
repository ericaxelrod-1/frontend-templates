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

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  
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
    // Get required roles from route data
    const requiredRoles = route.data['roles'] as Array<string>;
    console.log('[RoleGuard] Required roles:', requiredRoles);
    
    // If no roles required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      console.log('[RoleGuard] No roles required, allowing access');
      return true;
    }
    
    // Get the current user
    const isAuthenticated = this.store.selectSnapshot(AuthState.isAuthenticated);
    const currentUser = this.store.selectSnapshot(AuthState.user);
    console.log('[RoleGuard] Current user:', currentUser);
    
    // Redirect to login if not authenticated
    if (!isAuthenticated || !currentUser) {
      console.log('[RoleGuard] User not authenticated, redirecting to login');
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    // Use the PermissionService to check if the user has the required roles
    const hasPermission = this.permissionService.hasPermission(requiredRoles);
    
    if (!hasPermission) {
      console.log('[RoleGuard] Access denied, redirecting to dashboard');
      this.router.navigate(['/app/dashboard']);
    }
    
    return hasPermission;
  }
} 