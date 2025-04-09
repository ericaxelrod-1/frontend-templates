import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { PermissionService } from '../services/permission.service';
import { AuthService } from '../services/auth.service';

export interface PermissionData {
  resource: string;
  action: string;
  redirectUrl?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PermissionGuard {
  constructor(
    private permissionService: PermissionService,
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    const permissionData = route.data['permission'] as PermissionData;
    
    if (!permissionData || !permissionData.resource || !permissionData.action) {
      console.error('Permission guard: Missing permission data in route configuration');
      return false;
    }

    return this.authService.currentUser$.pipe(
      take(1),
      switchMap(user => {
        if (!user) {
          console.warn('Permission guard: No authenticated user');
          return this.handleUnauthorized(permissionData);
        }

        const { resource, action } = permissionData;
        
        return this.permissionService.hasPermission(resource, action).pipe(
          map(hasPermission => {
            if (hasPermission) {
              return true;
            }
            
            console.warn(`Permission guard: User ${user.id} does not have permission ${resource}:${action}`);
            return this.handleUnauthorized(permissionData);
          }),
          catchError(error => {
            console.error('Permission guard error:', error);
            return of(this.handleUnauthorized(permissionData));
          })
        );
      })
    );
  }

  private handleUnauthorized(permissionData: PermissionData): boolean | UrlTree {
    const redirectUrl = permissionData.redirectUrl || '/access-denied';
    return this.router.parseUrl(redirectUrl);
  }
} 