import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { map, shareReplay, tap, catchError } from 'rxjs/operators';
import { ServerResponse } from '../../models/server-response.model';

/**
 * Type definition for roles in the system
 * Using a string literal type for better type safety
 */
export type SystemRoleType = string;

/**
 * Interface for role object from API
 */
export interface SystemRole {
  id: number;
  name: string;
  description?: string;
  normalizedName?: string; // Make optional since we'll generate it
}

/**
 * Initially empty roles object that will be populated from the DB
 * This ensures we always have a valid object to reference even before roles are loaded
 */
export const SystemRoles: Record<string, SystemRoleType> = {};

/**
 * Legacy alias for backward compatibility
 */
export const UserRole = SystemRoles;

/**
 * Service to fetch and manage system roles
 */
@Injectable({
  providedIn: 'root'
})
export class RolesConstantsService {
  private apiUrl = `${environment.apiUrl}/roles`;
  private rolesSubject = new BehaviorSubject<Record<string, string>>({});
  private isInitialized = false;
  private initializeInProgress = false;

  // Expose roles as an observable
  public roles$ = this.rolesSubject.asObservable();

  constructor(private http: HttpClient) { }

  /**
   * Initialize by loading roles from the backend
   * Returns an observable that completes when roles are loaded
   */
  initialize(): Observable<void> {
    // If already initialized, return immediately
    if (this.isInitialized) {
      return of(void 0);
    }

    // If initialization is already in progress, return the observable that will complete when done
    if (this.initializeInProgress) {
      return this.roles$.pipe(map(() => void 0));
    }

    this.initializeInProgress = true;

    return this.http.get<ServerResponse<SystemRole>>(this.apiUrl).pipe(
      tap(response => {
        const roles = response.items;

        // Reset the SystemRoles object
        Object.keys(SystemRoles).forEach(key => {
          delete SystemRoles[key];
        });

        // Populate SystemRoles with values from API
        const rolesMap: Record<string, string> = {};
        roles.forEach(role => {
          // Generate normalizedName from name if not provided
          const normalizedName = role.normalizedName || role.name.toLowerCase().replace(/\s+/g, '');

          if (role && normalizedName) {
            // Store both uppercase and original case versions for maximum compatibility
            const upperKey = normalizedName.toUpperCase();
            const lowerKey = normalizedName.toLowerCase();

            // Add uppercase key for backward compatibility
            SystemRoles[upperKey] = normalizedName;
            rolesMap[upperKey] = normalizedName;

            // Add lowercase key for direct matches
            SystemRoles[lowerKey] = normalizedName;
            rolesMap[lowerKey] = normalizedName;

            // Also add the normalized name directly as a key
            SystemRoles[normalizedName] = normalizedName;
            rolesMap[normalizedName] = normalizedName;

            // Also add the original name as a key for direct lookups
            SystemRoles[role.name] = normalizedName;
            rolesMap[role.name] = normalizedName;
          } else {
            console.warn('RolesConstantsService: Received a role with missing name:', role);
          }
        });

        this.rolesSubject.next(rolesMap);
        this.isInitialized = true;
        this.initializeInProgress = false;
      }),
      catchError(error => {
        console.error('RolesConstantsService: Failed to load system roles:', error);
        this.initializeInProgress = false;

        // Create fallback values for critical system roles to prevent total failure
        console.warn('RolesConstantsService: Using fallback role values due to loading failure');
        const fallbackRoles = {
          'USER': 'user',
          'ADMIN': 'admin',
          'SUPERUSER': 'superuser',
          'SUPERADMIN': 'superadmin',
          'user': 'user',
          'admin': 'admin',
          'superuser': 'superuser',
          'superadmin': 'superadmin'
        };

        // Populate with fallback values
        Object.keys(fallbackRoles).forEach(key => {
          if (key) {
            SystemRoles[key] = fallbackRoles[key as keyof typeof fallbackRoles];
          }
        });

        this.rolesSubject.next(fallbackRoles);
        this.isInitialized = true; // Still mark as initialized with fallback values

        return of(void 0);
      }),
      map(() => void 0),
      shareReplay(1)
    );
  }

  /**
   * Check if roles have been loaded
   */
  isLoaded(): boolean {
    return this.isInitialized;
  }

  /**
   * Reset roles to uninitialized state
   * Used when logging out
   */
  reset(): void {
    // Clear the SystemRoles object
    Object.keys(SystemRoles).forEach(key => {
      if (key) {
        delete SystemRoles[key];
      }
    });

    this.rolesSubject.next({});
    this.isInitialized = false;
    this.initializeInProgress = false;
  }
} 