import { Injectable } from '@angular/core';
import { 
  CanActivate, 
  ActivatedRouteSnapshot, 
  RouterStateSnapshot, 
  Router, 
  UrlTree 
} from '@angular/router';
import { Observable, of, map } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    
    // Get required roles from route data
    const requiredRoles = route.data['roles'] as Array<string>;
    
    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    
    // Check if user is authenticated and has any of the required roles
    if (this.authService.isAuthenticated) {
      const hasRequiredRole = requiredRoles.some(role => 
        this.authService.hasRole(role)
      );
      
      if (hasRequiredRole) {
        return true;
      }
    }
    
    // If user doesn't have required role, redirect to dashboard or appropriate page
    console.log('RoleGuard: User does not have required roles:', requiredRoles);
    return this.router.createUrlTree(['/app/dashboard']);
  }
} 