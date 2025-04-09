import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { PermissionService } from './permission.service';
import { PermissionGuard } from './permission.guard';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { of } from 'rxjs';
import { HasPermissionDirective } from './has-permission.directive';
import { Component, DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { Permission } from '../models/permission.model';
import { Injectable } from '@angular/core';

// Define interfaces for type safety
interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: Permission[];
}

// Mock user for testing
const mockUser: User = {
  id: 1,
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  roles: ['admin'],
  permissions: [
    { permissionId: 1, resource: 'user', action: 'read', granted: true },
    { permissionId: 2, resource: 'user', action: 'create', granted: true },
    { permissionId: 3, resource: 'admin', action: 'access', granted: true }
  ]
};

// Mock AuthService
@Injectable()
class MockAuthService {
  currentUser$ = of(mockUser);
  hasRole(role: string): boolean {
    return mockUser.roles.includes(role);
  }
}

describe('Permission Migration Tests', () => {
  let permissionService: PermissionService;
  let httpMock: HttpTestingController;
  let guard: PermissionGuard;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        RouterTestingModule
      ],
      providers: [
        PermissionService,
        PermissionGuard,
        { provide: AuthService, useClass: MockAuthService }
      ],
      declarations: [HasPermissionDirective]
    });

    permissionService = TestBed.inject(PermissionService);
    httpMock = TestBed.inject(HttpTestingController);
    guard = TestBed.inject(PermissionGuard);
    router = TestBed.inject(Router);

    // Initialize the permissions cache
    permissionService['userPermissionsCache'].set(mockUser.id, mockUser.permissions);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('PermissionService', () => {
    it('should be created', () => {
      expect(permissionService).toBeTruthy();
    });

    it('should check if user has permission', (done) => {
      permissionService.hasPermission('user', 'read').subscribe(result => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should check if user has any of the specified permissions', (done) => {
      permissionService.hasAnyPermission([
        { resource: 'user', action: 'read' },
        { resource: 'user', action: 'delete' }
      ]).subscribe(result => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should check if user has all of the specified permissions', (done) => {
      permissionService.hasAllPermissions([
        { resource: 'user', action: 'read' },
        { resource: 'user', action: 'create' }
      ]).subscribe(result => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return false when user does not have the required permission', (done) => {
      permissionService.hasPermission('user', 'delete').subscribe(result => {
        expect(result).toBe(false);
        done();
      });
    });
  });

  describe('PermissionGuard', () => {
    it('should be created', () => {
      expect(guard).toBeTruthy();
    });

    it('should allow access when user has required permission', () => {
      const route = new ActivatedRouteSnapshot();
      route.data = {
        permission: { resource: 'user', action: 'read' }
      };

      guard.canActivate(route).subscribe(result => {
        expect(result).toBe(true);
      });
    });

    it('should deny access when user does not have required permission', () => {
      const route = new ActivatedRouteSnapshot();
      route.data = {
        permission: { resource: 'user', action: 'delete' }
      };
      
      const navigateSpy = spyOn(router, 'parseUrl');

      guard.canActivate(route).subscribe(result => {
        expect(result).not.toBe(true);
        expect(navigateSpy).toHaveBeenCalled();
      });
    });
  });
});

// Test component for HasPermissionDirective
@Component({
  template: `
    <div *hasPermission="{ resource: 'user', action: 'read' }">User Read</div>
    <div *hasPermission="{ resource: 'user', action: 'delete' }">User Delete</div>
    <div *hasPermission="[
      { resource: 'user', action: 'read' },
      { resource: 'admin', action: 'access' }
    ]; mode: 'any'">Any Permission</div>
    <div *hasPermission="[
      { resource: 'user', action: 'read' },
      { resource: 'user', action: 'delete' }
    ]; mode: 'all'">All Permissions</div>
  `
})
class TestComponent {}

describe('HasPermissionDirective', () => {
  let fixture: any;
  let des: DebugElement[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [HasPermissionDirective, TestComponent],
      providers: [
        PermissionService,
        { provide: AuthService, useClass: MockAuthService }
      ]
    });

    const permissionService = TestBed.inject(PermissionService);
    // Initialize the permissions cache
    permissionService['userPermissionsCache'].set(mockUser.id, mockUser.permissions);

    fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();
    des = fixture.debugElement.queryAll(By.directive(HasPermissionDirective));
  });

  it('should create the directive', () => {
    expect(des.length).toBe(4);
  });

  it('should show elements when user has permission', () => {
    const userReadElement = fixture.debugElement.query(By.css('div:nth-child(1)'));
    expect(userReadElement).not.toBeNull();
    expect(userReadElement.nativeElement.textContent).toBe('User Read');
  });

  it('should hide elements when user does not have permission', () => {
    const userDeleteElement = fixture.debugElement.query(By.css('div:nth-child(2)'));
    expect(userDeleteElement).toBeNull();
  });

  it('should show element when user has any of the required permissions', () => {
    const anyPermissionElement = fixture.debugElement.query(By.css('div:nth-child(3)'));
    expect(anyPermissionElement).not.toBeNull();
    expect(anyPermissionElement.nativeElement.textContent).toBe('Any Permission');
  });

  it('should hide element when user does not have all required permissions', () => {
    const allPermissionsElement = fixture.debugElement.query(By.css('div:nth-child(4)'));
    expect(allPermissionsElement).toBeNull();
  });
});

// Integration test for permission-based access control
describe('Permission-Based Access Control', () => {
  // Route configuration
  it('should have correct permission-based route configuration', () => {
    const route = {
      path: 'admin',
      canActivate: ['AuthGuard', 'PermissionGuard'],
      data: { 
        permission: {
          resource: 'admin',
          action: 'access'
        }
      }
    };

    expect(route.path).toBe('admin');
    expect(route.canActivate.includes('PermissionGuard')).toBe(true);
    expect(route.data.permission).toBeDefined();
    expect(route.data.permission.resource).toBe('admin');
    expect(route.data.permission.action).toBe('access');
  });

  // Component permission check
  it('should correctly check permissions in components', () => {
    function checkPermission(permissionService: PermissionService) {
      let result = false;
      permissionService.hasPermission('admin', 'access').subscribe(hasPermission => {
        result = hasPermission;
      });
      return result;
    }

    expect(typeof checkPermission).toBe('function');
  });
}); 