import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PermissionService } from './permission.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';

describe('PermissionService', () => {
  let service: PermissionService;
  let httpMock: HttpTestingController;
  const mockPermissions = ['user:read', 'user:create', 'report:view'];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PermissionService]
    });
    service = TestBed.inject(PermissionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Ensure no outstanding requests 
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('loadUserPermissions', () => {
    it('should fetch user permissions from the server', () => {
      service.loadUserPermissions().subscribe(permissions => {
        expect(permissions).toEqual(mockPermissions);
      });

      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      expect(req.request.method).toBe('GET');
      req.flush(mockPermissions);
    });

    it('should handle HTTP errors gracefully', () => {
      service.loadUserPermissions().subscribe(permissions => {
        expect(permissions).toEqual([]);
      });

      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush('Error', { status: 500, statusText: 'Server Error' });
    });

    it('should clear the permission cache when loading new permissions', () => {
      // Set up cache
      (service as any).permissionCache.set('user:read', true);
      
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      // Cache should be cleared and repopulated as permissions are checked
      expect((service as any).permissionCache.size).toBe(0);
    });
  });

  describe('hasPermission', () => {
    it('should return false initially before permissions are loaded', async () => {
      const result = await firstValueFrom(service.hasPermission('user', 'read'));
      expect(result).toBeFalse();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
    });

    it('should accept resource and action as separate parameters', async () => {
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      const result = await firstValueFrom(service.hasPermission('user', 'read'));
      expect(result).toBeTrue();
    });

    it('should return cached permission if available', async () => {
      // Load permissions first
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      // First check should cache the result
      await firstValueFrom(service.hasPermission('user', 'read'));
      
      // Second check should use the cached result
      const result = await firstValueFrom(service.hasPermission('user', 'read'));
      expect(result).toBeTrue();
      
      // No additional HTTP requests should have been made
      httpMock.expectNone(`${environment.apiUrl}/permissions/user-permissions`);
    });

    it('should wait for permissions to load if not loaded yet', async () => {
      // Start permission check
      const permissionPromise = firstValueFrom(service.hasPermission('user', 'read'));
      
      // Respond to the HTTP request that will be triggered
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      // Now the permission check should complete with the loaded permissions
      const result = await permissionPromise;
      expect(result).toBeTrue();
    });
  });

  describe('hasPermissionSync', () => {
    it('should return false if permissions are not loaded', () => {
      expect(service.hasPermissionSync('user:read')).toBeFalse();
    });

    it('should return true if permission is cached as granted', () => {
      // Set up cache
      (service as any).permissionCache.set('user:read', true);
      expect(service.hasPermissionSync('user:read')).toBeTrue();
    });

    it('should return false if permission is cached as denied', () => {
      // Set up cache
      (service as any).permissionCache.set('user:delete', false);
      expect(service.hasPermissionSync('user:delete')).toBeFalse();
    });

    it('should check the permissions array if not cached', () => {
      // Load permissions
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      // Check permission directly from array
      expect(service.hasPermissionSync('user:read')).toBeTrue();
      expect(service.hasPermissionSync('admin:delete')).toBeFalse();
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true if no permissions are specified', async () => {
      const result = await firstValueFrom(service.hasAllPermissions([]));
      expect(result).toBeTrue();
    });

    it('should return true if user has all specified permissions', async () => {
      // Load permissions
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      const result = await firstValueFrom(service.hasAllPermissions(['user:read', 'user:create']));
      expect(result).toBeTrue();
    });

    it('should return false if user lacks any of the specified permissions', async () => {
      // Load permissions
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      const result = await firstValueFrom(service.hasAllPermissions(['user:read', 'user:delete']));
      expect(result).toBeFalse();
    });
  });

  describe('hasAnyPermission', () => {
    it('should return false if no permissions are specified', async () => {
      const result = await firstValueFrom(service.hasAnyPermission([]));
      expect(result).toBeFalse();
    });

    it('should return true if user has at least one of the specified permissions', async () => {
      // Load permissions
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      const result = await firstValueFrom(service.hasAnyPermission(['user:read', 'user:delete']));
      expect(result).toBeTrue();
    });

    it('should return false if user has none of the specified permissions', async () => {
      // Load permissions
      service.loadUserPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      const result = await firstValueFrom(service.hasAnyPermission(['user:delete', 'user:admin']));
      expect(result).toBeFalse();
    });
  });

  describe('clearCache', () => {
    it('should clear all cached permissions', () => {
      // Set up cache
      (service as any).permissionCache.set('user:read', true);
      (service as any).permissionCache.set('user:delete', false);
      
      service.clearCache();
      
      expect((service as any).permissionCache.size).toBe(0);
    });
  });

  describe('refreshPermissions', () => {
    it('should set permissionsLoaded to false and reload permissions', () => {
      // Set loaded flag to true
      (service as any).permissionsLoadedSubject.next(true);
      
      service.refreshPermissions().subscribe();
      
      const req = httpMock.expectOne(`${environment.apiUrl}/permissions/user-permissions`);
      req.flush(mockPermissions);
      
      // Should be set back to true after loading
      expect((service as any).permissionsLoadedSubject.value).toBeTrue();
    });
  });
}); 