import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../core/services/auth.service';
import { PermissionService } from '../core/services/permission.service';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { User, Permission } from '../models/user.model';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

// Mock User for testing
export const mockUser: User = {
  id: 1,
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  isVerified: true,
  permissions: [
    {
      id: '1',
      name: 'Create User',
      description: 'Can create users',
      resourceName: 'user',
      actionName: 'create'
    },
    {
      id: '2',
      name: 'Read User',
      description: 'Can read users',
      resourceName: 'user',
      actionName: 'read'
    }
  ],
  roles: ['USER'] // Kept for backward compatibility
};

// Mock AuthService
export class MockAuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(mockUser);
  currentUser$ = this.currentUserSubject.asObservable();
  currentUser = mockUser;

  login(): Observable<any> {
    return of({ token: 'mock-token', user: mockUser });
  }

  logout(): void {
    this.currentUserSubject.next(null);
  }

  isAuthenticated(): boolean {
    return true;
  }
}

// Mock PermissionService
export class MockPermissionService {
  private permissionCache = new Map<string, boolean>();
  private loadedPermissions = new BehaviorSubject<Permission[]>(mockUser.permissions || []);
  permissions$ = this.loadedPermissions.asObservable();
  private permissionsLoadedSubject = new BehaviorSubject<boolean>(true);
  permissionsLoaded$ = this.permissionsLoadedSubject.asObservable();

  constructor() {
    // Pre-populate cache with mock user permissions
    mockUser.permissions?.forEach(p => {
      const key = `${p.resourceName}:${p.actionName}`;
      this.permissionCache.set(key, true);
    });
  }

  loadUserPermissions(): Observable<Permission[]> {
    return of(mockUser.permissions || []);
  }

  hasPermission(resource: string, action?: string): Observable<boolean> {
    // Convert to permission string if resource and action provided separately
    const permissionString = action ? `${resource}:${action}` : resource;
    
    // Return from cache if available
    if (this.permissionCache.has(permissionString)) {
      return of(this.permissionCache.get(permissionString)!);
    }
    
    const hasPermission = mockUser.permissions?.some(
      p => action ? 
        (p.resourceName === resource && p.actionName === action) :
        `${p.resourceName}:${p.actionName}` === permissionString
    ) ?? false;
    
    this.permissionCache.set(permissionString, hasPermission);
    return of(hasPermission);
  }

  hasPermissionSync(permission: string): boolean {
    const [resource, action] = permission.split(':');
    return this.hasPermission(resource, action) ? true : false;
  }

  hasAnyPermission(permissions: string[]): Observable<boolean> {
    return of(permissions.some(permission => this.hasPermissionSync(permission)));
  }

  hasAllPermissions(permissions: string[]): Observable<boolean> {
    if (!permissions.length) return of(true);
    return of(permissions.every(permission => this.hasPermissionSync(permission)));
  }

  clearCache(): void {
    this.permissionCache.clear();
  }

  refreshPermissions(): Observable<Permission[]> {
    return this.loadUserPermissions();
  }
}

// Helper function to setup HTTP testing
export function setupHttpTesting(): HttpTestingController {
  const httpMock = TestBed.inject(HttpTestingController);
  return httpMock;
}

// Shared Testing Module
@NgModule({
  imports: [
    CommonModule,
    HttpClientTestingModule,
    RouterTestingModule,
    BrowserAnimationsModule,
    MatSnackBarModule
  ],
  providers: [
    { provide: AuthService, useClass: MockAuthService },
    { provide: PermissionService, useClass: MockPermissionService },
    { 
      provide: ActivatedRoute, 
      useValue: {
        params: of({ id: '1' }),
        snapshot: {
          paramMap: {
            get: (key: string) => '1'
          }
        }
      }
    },
    {
      provide: Router,
      useValue: {
        navigate: jasmine.createSpy('navigate')
      }
    }
  ],
  exports: [
    CommonModule,
    HttpClientTestingModule,
    RouterTestingModule,
    BrowserAnimationsModule,
    MatSnackBarModule
  ]
})
export class TestingModule { }

// Helper function to setup common test configuration
export function setupTestConfiguration(additionalImports: any[] = [], additionalProviders: any[] = []) {
  return {
    imports: [
      TestingModule,
      ...additionalImports
    ],
    providers: [
      ...additionalProviders
    ]
  };
} 