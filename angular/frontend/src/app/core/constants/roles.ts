import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { map, shareReplay, tap, catchError } from 'rxjs/operators';

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
  normalizedName: string;
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
  
  constructor(private http: HttpClient) {}
  
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
    
    return this.http.get<SystemRole[]>(this.apiUrl).pipe(
      tap(roles => {
        // Reset the SystemRoles object
        Object.keys(SystemRoles).forEach(key => {
          delete SystemRoles[key];
        });
        
        // Populate SystemRoles with values from API
        const rolesMap: Record<string, string> = {};
        roles.forEach(role => {
          // Convert role name to UPPERCASE for key to maintain backwards compatibility
          const key = role.normalizedName.toUpperCase();
          SystemRoles[key] = role.normalizedName;
          rolesMap[key] = role.normalizedName;
        });
        
        this.rolesSubject.next(rolesMap);
        this.isInitialized = true;
        this.initializeInProgress = false;
        console.log('Loaded system roles:', SystemRoles);
      }),
      catchError(error => {
        console.error('Failed to load system roles:', error);
        this.initializeInProgress = false;
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
      delete SystemRoles[key];
    });
    
    this.rolesSubject.next({});
    this.isInitialized = false;
    this.initializeInProgress = false;
  }
} 