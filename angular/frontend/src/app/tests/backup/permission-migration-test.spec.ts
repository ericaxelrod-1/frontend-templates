import { TestBed } from '@angular/core/testing';
import { AuthService } from '../core/services/auth.service';
import { PermissionService } from '../core/services/permission.service';
import { TestingModule, mockUser, setupHttpTesting } from './test-utils';
import { HttpTestingController } from '@angular/common/http/testing';

describe('Permission Migration Tests', () => {
  let authService: AuthService;
  let permissionService: PermissionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestingModule]
    });

    authService = TestBed.inject(AuthService);
    permissionService = TestBed.inject(PermissionService);
    httpMock = setupHttpTesting();
  });

  afterEach(() => {
    httpMock.verify(); // Ensure no outstanding requests
  });

  it('should check permissions correctly after migration', (done) => {
    expect(authService.currentUser).toBeTruthy();
    
    permissionService.loadUserPermissions().subscribe(() => {
      expect(permissionService.hasPermission('user', 'create')).toBeTrue();
      expect(permissionService.hasPermission('user', 'read')).toBeTrue();
      expect(permissionService.hasPermission('user', 'delete')).toBeFalse();
      done();
    });
  });

  it('should handle permission string format correctly', (done) => {
    permissionService.loadUserPermissions().subscribe(() => {
      expect(permissionService.hasPermissionSync('user:create')).toBeTrue();
      expect(permissionService.hasPermissionSync('user:read')).toBeTrue();
      expect(permissionService.hasPermissionSync('user:delete')).toBeFalse();
      done();
    });
  });

  it('should cache permission checks', (done) => {
    permissionService.loadUserPermissions().subscribe(() => {
      // First check should cache the result
      expect(permissionService.hasPermission('user', 'create')).toBeTrue();
      
      // Second check should use cached result
      expect(permissionService.hasPermission('user', 'create')).toBeTrue();
      done();
    });
  });

  it('should clear permission cache', (done) => {
    permissionService.loadUserPermissions().subscribe(() => {
      // Cache a permission check
      expect(permissionService.hasPermission('user', 'create')).toBeTrue();
      
      // Clear cache
      permissionService.clearCache();
      
      // Should recheck permission
      expect(permissionService.hasPermission('user', 'create')).toBeTrue();
      done();
    });
  });

  it('should refresh permissions', (done) => {
    permissionService.refreshPermissions().subscribe(permissions => {
      expect(permissions).toEqual(jasmine.arrayContaining(
        mockUser.permissions.map(p => jasmine.objectContaining({
          id: p.id,
          name: p.name,
          resourceName: p.resourceName,
          actionName: p.actionName
        }))
      ));
      done();
    });
  });
}); 