import { CommonModule } from '@angular/common';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, Observable } from 'rxjs';
import { PermissionService } from '../core/services/permission.service';
import { NotificationService } from '../core/services/notification.service';
import { AuthService } from '../core/services/auth.service';
import { User, Permission } from '../models/user.model';

/**
 * Creates a mock user for testing
 */
export const createMockUser = (overrides?: Partial<User>): User => ({
  id: 1,
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  isVerified: true,
  permissions: [
    {
      id: 1,
      name: 'View User',
      description: 'Can view user data',
      resourceName: 'user',
      actionName: 'view'
    },
    {
      id: 2,
      name: 'Create User',
      description: 'Can create users',
      resourceName: 'user',
      actionName: 'create'
    }
  ],
  roles: [{ id: 1, name: 'USER', description: 'Standard user role' }],
  ...overrides
});

/**
 * Creates a standardized TestBed configuration
 */
export const setupTestBed = ({
  declarations = [],
  imports = [],
  providers = []
}: {
  declarations?: any[];
  imports?: any[];
  providers?: any[];
} = {}) => {
  // Create mock services
  const mockPermissionService = jasmine.createSpyObj('PermissionService', {
    loadUserPermissions: of(['user:view', 'user:create']),
    hasPermission: of(true),
    hasAllPermissions: of(true),
    hasAnyPermission: of(true),
    clearCache: undefined,
    refreshPermissions: of(['user:view', 'user:create'])
  });

  const mockAuthService = jasmine.createSpyObj('AuthService', {
    isAuthenticated: true,
    login: of({ token: 'mock-token', user: createMockUser() }),
    logout: undefined,
    refreshToken: of({ token: 'mock-refresh-token' })
  });
  mockAuthService.currentUser = createMockUser();
  mockAuthService.currentUser$ = of(createMockUser());

  const mockRouter = jasmine.createSpyObj('Router', ['navigate']);
  
  const mockActivatedRoute = {
    snapshot: {
      paramMap: {
        get: (key: string) => '1'
      },
      queryParamMap: {
        get: (key: string) => null
      }
    },
    params: of({ id: '1' }),
    queryParams: of({})
  };

  // Return TestBed configuration
  return {
    declarations: [...declarations],
    imports: [
      CommonModule,
      HttpClientTestingModule,
      RouterTestingModule,
      ReactiveFormsModule,
      FormsModule,
      NoopAnimationsModule,
      MatSnackBarModule,
      ...imports
    ],
    providers: [
      { provide: PermissionService, useValue: mockPermissionService },
      { provide: AuthService, useValue: mockAuthService },
      { provide: Router, useValue: mockRouter },
      { provide: ActivatedRoute, useValue: mockActivatedRoute },
      NotificationService,
      ...providers
    ]
  };
};

/**
 * Creates a component fixture with standardized configuration
 */
export function createComponentFixture<T>(
  component: any,
  config?: {
    declarations?: any[];
    imports?: any[];
    providers?: any[];
  }
): ComponentFixture<T> {
  TestBed.configureTestingModule(setupTestBed(config || {}));
  return TestBed.createComponent(component);
}

/**
 * Configures permission service mocks for specific test cases
 */
export function configurePermissions(
  fixture: ComponentFixture<any>,
  config: {
    permissions?: string[];
    hasPermission?: boolean | Record<string, boolean>;
    hasAllPermissions?: boolean;
    hasAnyPermission?: boolean;
  }
) {
  const permissionService = TestBed.inject(PermissionService) as jasmine.SpyObj<PermissionService>;
  
  // Configure loadUserPermissions
  if (config.permissions) {
    permissionService.loadUserPermissions.and.returnValue(of(config.permissions));
  }
  
  // Configure hasPermission
  if (typeof config.hasPermission === 'boolean') {
    // Global permission setting
    permissionService.hasPermission.and.returnValue(of(config.hasPermission));
  } else if (typeof config.hasPermission === 'object' && config.hasPermission !== null) {
    // Permission map for different resources/actions
    permissionService.hasPermission.and.callFake((resource: string, action?: string) => {
      const key = action ? `${resource}:${action}` : resource;
      const permissionMap = config.hasPermission as Record<string, boolean>;
      return of(permissionMap[key] ?? false);
    });
  }
  
  // Configure hasAllPermissions
  if (config.hasAllPermissions !== undefined) {
    permissionService.hasAllPermissions.and.returnValue(of(config.hasAllPermissions));
  }
  
  // Configure hasAnyPermission
  if (config.hasAnyPermission !== undefined) {
    permissionService.hasAnyPermission.and.returnValue(of(config.hasAnyPermission));
  }
  
  return permissionService;
} 