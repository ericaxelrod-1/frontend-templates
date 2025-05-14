import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, map, tap, retry, finalize } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface Permission {
  id: string;
  name: string;
  description: string;
  resourceName: string;
  actionName: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

/**
 * Service for managing and checking user permissions.
 * Handles communication with the backend API for permission checks,
 * permission management, and caches results for performance.
 */
@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private userPermissionsSubject = new BehaviorSubject<string[]>([]);
  userPermissions$ = this.userPermissionsSubject.asObservable();
  
  private permissionsLoadedSubject = new BehaviorSubject<boolean>(false);
  permissionsLoaded$ = this.permissionsLoadedSubject.asObservable();
  
  private permissionCache = new Map<string, boolean>();
  private loadingPermissions = false;
  
  constructor(private http: HttpClient) {
    // Don't auto-load permissions in constructor to avoid circular dependencies
  }
  
  /**
   * Load the current user's permissions from the server
   */
  loadUserPermissions(): Observable<string[]> {
    // Avoid making duplicate requests while loading
    if (this.loadingPermissions) {
      return this.userPermissions$;
    }
    
    // Return cached permissions if already loaded
    if (this.permissionsLoadedSubject.value) {
      return of(this.userPermissionsSubject.value);
    }
    
    this.loadingPermissions = true;
    
    const url = `${environment.apiUrl}/permissions/user-permissions`;
    return this.http.get<string[]>(url).pipe(
      retry(2), // Retry failed requests up to 2 times
      tap(permissions => {
        this.userPermissionsSubject.next(permissions);
        this.permissionsLoadedSubject.next(true);
        this.permissionCache.clear(); // Clear cache when permissions change
      }),
      catchError(this.handleError<string[]>([])),
      finalize(() => {
        this.loadingPermissions = false;
      })
    );
  }
  
  /**
   * Check if the user has a specific permission
   * Supports both single permission string and resource/action pair formats
   * 
   * @param permission The permission to check (format: 'resource:action') or resource name
   * @param action Optional action name when first parameter is resource name
   * @returns Observable<boolean> indicating if the user has the permission
   */
  hasPermission(permission: string, action?: string): Observable<boolean> {
    // Convert to permission string if resource and action provided separately
    const permissionString = action ? `${permission}:${action}` : permission;
    
    // Return from cache if available
    if (this.permissionCache.has(permissionString)) {
      return of(this.permissionCache.get(permissionString) as boolean);
    }
    
    // If permissions aren't loaded yet, wait for them
    if (!this.permissionsLoadedSubject.value) {
      return this.loadUserPermissions().pipe(
        map(() => {
          const hasPermission = this.userPermissionsSubject.value.includes(permissionString);
          this.permissionCache.set(permissionString, hasPermission);
          return hasPermission;
        })
      );
    }
    
    // Otherwise check immediately
    const hasPermission = this.userPermissionsSubject.value.includes(permissionString);
    this.permissionCache.set(permissionString, hasPermission);
    return of(hasPermission);
  }
  
  /**
   * Sync version of hasPermission that returns the current value
   * @param permission The permission to check (format: 'resource:action') 
   * @returns boolean indicating if the user has the permission
   */
  hasPermissionSync(permission: string): boolean {
    if (!this.permissionsLoadedSubject.value) {
      return false; // Permissions not loaded yet
    }
    
    if (this.permissionCache.has(permission)) {
      return this.permissionCache.get(permission) as boolean;
    }
    
    const hasPermission = this.userPermissionsSubject.value.includes(permission);
    this.permissionCache.set(permission, hasPermission);
    return hasPermission;
  }
  
  /**
   * Check if the user has all of the specified permissions
   * @param permissions Array of permissions to check
   * @returns Observable<boolean> indicating if the user has all permissions
   */
  hasAllPermissions(permissions: string[]): Observable<boolean> {
    if (permissions.length === 0) {
      return of(true);
    }
    
    // If permissions aren't loaded yet, load them first
    if (!this.permissionsLoadedSubject.value) {
      return this.loadUserPermissions().pipe(
        map(() => permissions.every(permission => this.hasPermissionSync(permission)))
      );
    }
    
    return of(permissions.every(permission => this.hasPermissionSync(permission)));
  }
  
  /**
   * Check if the user has any of the specified permissions
   * @param permissions Array of permissions to check
   * @returns Observable<boolean> indicating if the user has any of the permissions
   */
  hasAnyPermission(permissions: string[]): Observable<boolean> {
    if (permissions.length === 0) {
      return of(false);
    }
    
    // If permissions aren't loaded yet, load them first
    if (!this.permissionsLoadedSubject.value) {
      return this.loadUserPermissions().pipe(
        map(() => permissions.some(permission => this.hasPermissionSync(permission)))
      );
    }
    
    return of(permissions.some(permission => this.hasPermissionSync(permission)));
  }
  
  /**
   * Force refresh permissions from the server
   */
  refreshPermissions(): Observable<string[]> {
    this.permissionsLoadedSubject.next(false);
    this.permissionCache.clear();
    return this.loadUserPermissions();
  }
  
  /**
   * Clear the permissions cache
   */
  clearCache(): void {
    this.permissionCache.clear();
    this.permissionsLoadedSubject.next(false);
    this.userPermissionsSubject.next([]);
  }
  
  /**
   * Handle HTTP errors with type safety
   * @param defaultValue The default value to return on error
   */
  private handleError<T>(defaultValue: T) {
    return (error: HttpErrorResponse): Observable<T> => {
      console.error('An error occurred:', error);
      
      let errorMessage = 'An error occurred while loading permissions. ';
      if (error.error instanceof ErrorEvent) {
        // Client-side error
        errorMessage += `Error: ${error.error.message}`;
      } else {
        // Server-side error
        errorMessage += `Error Code: ${error.status}\nMessage: ${error.message}`;
      }
      
      return of(defaultValue);
    };
  }

  /**
   * Sync permissions from the backend
   * @param type Type of permissions to sync ('all', 'components', 'routes', 'endpoints')
   * @returns Observable indicating success
   */
  syncPermissions(type: 'all' | 'components' | 'routes' | 'endpoints'): Observable<boolean> {
    const url = `${environment.apiUrl}/permissions/sync/${type}`;
    return this.http.post<boolean>(url, {}).pipe(
      retry(2),
      tap(() => {
        this.clearCache();
        this.loadUserPermissions().subscribe();
      }),
      catchError(this.handleError<boolean>(false))
    );
  }

  /**
   * Get all available permissions
   */
  getAllPermissions(): Observable<Permission[]> {
    const url = `${environment.apiUrl}/permissions`;
    return this.http.get<Permission[]>(url).pipe(
      retry(2),
      catchError(this.handleError<Permission[]>([]))
    );
  }

  /**
   * Get all groups with their permissions
   */
  getAllGroups(): Observable<Group[]> {
    const url = `${environment.apiUrl}/permissions/groups`;
    return this.http.get<Group[]>(url).pipe(
      retry(2),
      catchError(this.handleError<Group[]>([]))
    );
  }

  /**
   * Get all roles with their permissions
   */
  getAllRoles(): Observable<Role[]> {
    const url = `${environment.apiUrl}/permissions/roles`;
    return this.http.get<Role[]>(url).pipe(
      retry(2),
      catchError(this.handleError<Role[]>([]))
    );
  }

  /**
   * Update permissions for a group
   * @param groupId Group ID
   * @param permissions Array of permission IDs
   */
  updateGroupPermissions(groupId: string, permissions: string[]): Observable<void> {
    const url = `${environment.apiUrl}/permissions/groups/${groupId}/permissions`;
    return this.http.put<void>(url, { permissions }).pipe(
      retry(2),
      tap(() => {
        this.clearCache();
        this.loadUserPermissions().subscribe();
      }),
      catchError(this.handleError<void>(undefined))
    );
  }

  /**
   * Update permissions for a role
   * @param roleId Role ID
   * @param permissions Array of permission IDs
   */
  updateRolePermissions(roleId: string, permissions: string[]): Observable<void> {
    const url = `${environment.apiUrl}/permissions/roles/${roleId}/permissions`;
    return this.http.put<void>(url, { permissions }).pipe(
      retry(2),
      tap(() => {
        this.clearCache();
        this.loadUserPermissions().subscribe();
      }),
      catchError(this.handleError<void>(undefined))
    );
  }

  /**
   * Get permissions for a specific group
   * @param groupId Group ID
   */
  getGroupPermissions(groupId: string): Observable<Permission[]> {
    const url = `${environment.apiUrl}/permissions/groups/${groupId}/permissions`;
    return this.http.get<Permission[]>(url).pipe(
      retry(2),
      catchError(this.handleError<Permission[]>([]))
    );
  }

  /**
   * Get permissions for a specific role
   * @param roleId Role ID
   */
  getRolePermissions(roleId: string): Observable<Permission[]> {
    const url = `${environment.apiUrl}/permissions/roles/${roleId}/permissions`;
    return this.http.get<Permission[]>(url).pipe(
      retry(2),
      catchError(this.handleError<Permission[]>([]))
    );
  }
} 