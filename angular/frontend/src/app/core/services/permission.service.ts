import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface Permission {
  id: string;
  name: string;
  description: string;
  resourceName: string;
  actionName: string;
}

/**
 * Service for checking user permissions.
 * Handles communication with the backend API for permission checks
 * and caches results for performance.
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
  
  constructor(private http: HttpClient) {
    // Don't auto-load permissions in constructor to avoid circular dependencies
  }
  
  /**
   * Load the current user's permissions from the server
   */
  loadUserPermissions(): Observable<string[]> {
    // Avoid making duplicate requests
    if (this.permissionsLoadedSubject.value) {
      return of(this.userPermissionsSubject.value);
    }
    
    const url = `${environment.apiUrl}/permissions/user-permissions`;
    return this.http.get<string[]>(url).pipe(
      tap(permissions => {
        this.userPermissionsSubject.next(permissions);
        this.permissionsLoadedSubject.next(true);
        this.permissionCache.clear(); // Clear cache when permissions change
      }),
      catchError(error => {
        console.error('Error loading user permissions:', error);
        return of([]);
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
   * Reset the permission cache
   */
  clearCache(): void {
    this.permissionCache.clear();
  }
  
  /**
   * Reload user permissions from the server
   */
  refreshPermissions(): Observable<string[]> {
    this.permissionsLoadedSubject.next(false);
    this.permissionCache.clear();
    return this.loadUserPermissions();
  }
} 