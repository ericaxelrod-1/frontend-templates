import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, BehaviorSubject } from 'rxjs';
import { map, tap, catchError, shareReplay } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface UserPermission {
  permissionId: number;
  resource: string;
  action: string;
  granted: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private apiUrl = `${environment.apiUrl}/permissions`;
  private userPermissionsCache = new Map<number, UserPermission[]>();
  private permissionsCache$: Observable<Permission[]> | null = null;
  private refreshPermissions$ = new BehaviorSubject<void>(undefined);

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {
    // Clear cache when user changes
    this.authService.currentUser$.subscribe(() => {
      this.clearCache();
    });
  }

  /**
   * Get all permissions in the system
   */
  getAllPermissions(): Observable<Permission[]> {
    if (!this.permissionsCache$) {
      this.permissionsCache$ = this.http.get<Permission[]>(`${this.apiUrl}`).pipe(
        shareReplay(1)
      );
    }
    return this.permissionsCache$;
  }

  /**
   * Get current user's effective permissions
   */
  getUserPermissions(): Observable<UserPermission[]> {
    return this.authService.currentUser$.pipe(
      map(user => {
        if (!user) {
          return [];
        }
        
        // Return from cache if available
        if (this.userPermissionsCache.has(user.id)) {
          return this.userPermissionsCache.get(user.id) || [];
        }
        
        return [];
      }),
      catchError(() => of([])),
      // If not in cache or on refresh, fetch from server
      tap(cachedPermissions => {
        if (cachedPermissions.length === 0) {
          this.refreshUserPermissions();
        }
      })
    );
  }

  /**
   * Check if current user has specific permission
   */
  hasPermission(resource: string, action: string): Observable<boolean> {
    return this.getUserPermissions().pipe(
      map(permissions => {
        // First check for any explicit deny
        const explicitDeny = permissions.find(p => 
          p.resource === resource && 
          p.action === action && 
          !p.granted
        );
        
        if (explicitDeny) {
          return false;
        }
        
        // Then check for any grant
        return permissions.some(p => 
          p.resource === resource && 
          p.action === action && 
          p.granted
        );
      })
    );
  }

  /**
   * Check if current user has any of the specified permissions
   */
  hasAnyPermission(permissions: Array<{resource: string, action: string}>): Observable<boolean> {
    return this.getUserPermissions().pipe(
      map(userPermissions => {
        return permissions.some(required => 
          userPermissions.some(p => 
            p.resource === required.resource && 
            p.action === required.action && 
            p.granted
          )
        );
      })
    );
  }

  /**
   * Check if current user has all of the specified permissions
   */
  hasAllPermissions(permissions: Array<{resource: string, action: string}>): Observable<boolean> {
    return this.getUserPermissions().pipe(
      map(userPermissions => {
        return permissions.every(required => 
          userPermissions.some(p => 
            p.resource === required.resource && 
            p.action === required.action && 
            p.granted
          )
        );
      })
    );
  }

  /**
   * Force refresh of current user's permissions from server
   */
  refreshUserPermissions(): Observable<UserPermission[]> {
    return this.authService.currentUser$.pipe(
      map(user => user?.id),
      tap(userId => {
        if (!userId) {
          return;
        }
        
        this.http.get<UserPermission[]>(`${this.apiUrl}/user`).pipe(
          tap(permissions => {
            this.userPermissionsCache.set(userId, permissions);
            this.refreshPermissions$.next();
          }),
          catchError(error => {
            console.error('Failed to fetch user permissions:', error);
            return of([]);
          })
        ).subscribe();
      }),
      map(userId => userId ? this.userPermissionsCache.get(userId) || [] : [])
    );
  }

  /**
   * Clear permissions cache
   */
  clearCache(): void {
    this.userPermissionsCache.clear();
    this.permissionsCache$ = null;
    this.refreshPermissions$.next();
  }

  /**
   * Get permissions for a specific resource
   */
  getResourcePermissions(resource: string): Observable<Permission[]> {
    return this.getAllPermissions().pipe(
      map(permissions => permissions.filter(p => p.resource === resource))
    );
  }

  /**
   * Get user's permissions for a specific resource
   */
  getUserResourcePermissions(resource: string): Observable<UserPermission[]> {
    return this.getUserPermissions().pipe(
      map(permissions => permissions.filter(p => p.resource === resource))
    );
  }
} 