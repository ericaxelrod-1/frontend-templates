import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from '../services/permissions.service';
import { ManifestService } from '../scanners/manifest.service';
import { ComponentScannerService } from '../scanners/component-scanner.service';
import { RouteScannerService } from '../scanners/route-scanner.service';
import { EndpointScannerService } from '../scanners/endpoint-scanner.service';
import { CacheSyncService } from '../services/cache-sync.service';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { GroupPermission } from '../entities/group-permission.entity';
import { UserPermission } from '../entities/user-permission.entity';
import { Component } from '../entities/component.entity';
import { Route } from '../entities/route.entity';
import { Endpoint } from '../entities/endpoint.entity';

// Interface for authenticated user
interface AuthUser {
  id: number;
  username?: string;
  email?: string;
  roles?: string[];
  groups?: string[];
}

// Helper type for partial mock objects
type PartialPermission = Partial<Permission> & {
  id: string;
  resourceName: string;
  actionName: string;
  name: string;
  rolePermissions?: Partial<RolePermission>[];
  groupPermissions?: Partial<GroupPermission>[];
  userPermissions?: Partial<UserPermission>[];
  components?: Partial<Component>[];
  routes?: Partial<Route>[];
  endpoints?: Partial<Endpoint>[];
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

// Helper function to create mock Request objects
const createMockRequest = (user: AuthUser | null = null): Request => {
  return {
    user,
    get: jest.fn(),
    header: jest.fn(),
    accepts: jest.fn(),
    acceptsCharsets: jest.fn(),
    acceptsEncodings: jest.fn(),
    acceptsLanguages: jest.fn(),
    range: jest.fn(),
    // Add other required Request properties
    app: {} as any,
    res: {} as any,
    body: {},
    params: {},
    query: {},
    headers: {},
    cookies: {},
    signedCookies: {},
    fresh: false,
    stale: true,
    secure: false,
    ip: '',
    ips: [],
    subdomains: [],
    path: '',
    hostname: '',
    host: '',
    protocol: '',
    xhr: false,
    route: {} as any,
    originalUrl: '',
    baseUrl: '',
    url: '',
    method: 'GET',
  } as unknown as Request;
};

describe('PermissionsController', () => {
  let controller: PermissionsController;
  let permissionsService: jest.Mocked<PermissionsService>;
  let manifestService: jest.Mocked<ManifestService>;
  let componentScannerService: jest.Mocked<ComponentScannerService>;
  let routeScannerService: jest.Mocked<RouteScannerService>;
  let endpointScannerService: jest.Mocked<EndpointScannerService>;
  let cacheSyncService: jest.Mocked<CacheSyncService>;

  const mockPermissionsService = {
    getUserPermissions: jest.fn(),
    checkUserPermission: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findAllResources: jest.fn(),
    findAllActions: jest.fn(),
    updateUserPermission: jest.fn(),
    getRolePermissions: jest.fn(),
    updateRolePermission: jest.fn(),
    getGroupPermissions: jest.fn(),
    updateGroupPermission: jest.fn(),
    getAllComponents: jest.fn(),
    getComponentById: jest.fn(),
    updateComponentPermissions: jest.fn(),
    getAllRoutes: jest.fn(),
    getRouteById: jest.fn(),
    updateRoutePermissions: jest.fn(),
    canUserAccessRoute: jest.fn(),
    getAllEndpoints: jest.fn(),
    getEndpointById: jest.fn(),
    updateEndpointPermissions: jest.fn(),
    canUserAccessEndpoint: jest.fn(),
    getUserRoles: jest.fn(),
    seedDefaultPermissions: jest.fn(),
  };

  const mockManifestService = {
    getManifest: jest.fn(),
    generateManifest: jest.fn(),
  };

  const mockComponentScannerService = {
    scanComponents: jest.fn(),
  };

  const mockRouteScannerService = {
    scanRoutes: jest.fn(),
  };

  const mockEndpointScannerService = {
    scanEndpoints: jest.fn(),
  };

  const mockCacheSyncService = {
    syncPermissionsToCache: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: ManifestService, useValue: mockManifestService },
        {
          provide: ComponentScannerService,
          useValue: mockComponentScannerService,
        },
        { provide: RouteScannerService, useValue: mockRouteScannerService },
        {
          provide: EndpointScannerService,
          useValue: mockEndpointScannerService,
        },
        { provide: CacheSyncService, useValue: mockCacheSyncService },
      ],
    }).compile();

    controller = module.get<PermissionsController>(PermissionsController);
    permissionsService = module.get(PermissionsService);
    manifestService = module.get(ManifestService);
    componentScannerService = module.get(ComponentScannerService);
    routeScannerService = module.get(RouteScannerService);
    endpointScannerService = module.get(EndpointScannerService);
    cacheSyncService = module.get(CacheSyncService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserPermissions', () => {
    const mockUserId = 123;
    const mockPermissions = ['users:read', 'groups:write'];
    const mockRequest = createMockRequest({ id: mockUserId });

    it('should return user permissions for authenticated user', async () => {
      permissionsService.getUserPermissions.mockResolvedValue(mockPermissions);

      const result = await controller.getUserPermissions(mockRequest);

      expect(result).toEqual(mockPermissions);
      expect(permissionsService.getUserPermissions).toHaveBeenCalledWith(
        mockUserId,
      );
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      const unauthenticatedRequest = createMockRequest(null);

      await expect(
        controller.getUserPermissions(unauthenticatedRequest),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user ID is missing', async () => {
      const invalidRequest = createMockRequest({});

      await expect(
        controller.getUserPermissions(invalidRequest),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('checkPermission', () => {
    const mockResource = 'users';
    const mockAction = 'read';
    const mockUserId = 123;
    const mockRequest = createMockRequest({ id: mockUserId });

    it('should check permission for specified user', async () => {
      permissionsService.checkUserPermission.mockResolvedValue(true);

      const result = await controller.checkPermission(
        mockResource,
        mockAction,
        mockUserId,
      );

      expect(result).toEqual({ hasPermission: true });
      expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
        mockUserId,
        mockResource,
        mockAction,
      );
    });

    it('should check permission for authenticated user when userId not provided', async () => {
      permissionsService.checkUserPermission.mockResolvedValue(true);

      const result = await controller.checkPermission(
        mockResource,
        mockAction,
        undefined,
        mockRequest,
      );

      expect(result).toEqual({ hasPermission: true });
      expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
        mockUserId,
        mockResource,
        mockAction,
      );
    });

    it('should throw UnauthorizedException when no user ID available', async () => {
      await expect(
        controller.checkPermission(mockResource, mockAction),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getAllPermissions', () => {
    const mockPermissions: PartialPermission[] = [
      {
        id: '1',
        resourceName: 'users',
        actionName: 'read',
        name: 'users:read',
      },
      {
        id: '2',
        resourceName: 'groups',
        actionName: 'write',
        name: 'groups:write',
      },
    ];

    it('should return all permissions', async () => {
      permissionsService.findAll.mockResolvedValue(
        mockPermissions as Permission[],
      );

      const result = await controller.getAllPermissions();

      expect(result).toEqual(mockPermissions);
      expect(permissionsService.findAll).toHaveBeenCalled();
    });
  });

  describe('getPermissionById', () => {
    const mockPermissionId = '123';
    const mockPermission: PartialPermission = {
      id: mockPermissionId,
      resourceName: 'users',
      actionName: 'read',
      name: 'users:read',
    };

    it('should return permission by ID', async () => {
      permissionsService.findById.mockResolvedValue(
        mockPermission as Permission,
      );

      const result = await controller.getPermissionById(mockPermissionId);

      expect(result).toEqual(mockPermission);
      expect(permissionsService.findById).toHaveBeenCalledWith(
        mockPermissionId,
      );
    });

    it('should throw NotFoundException when permission not found', async () => {
      permissionsService.findById.mockResolvedValue(null);

      await expect(
        controller.getPermissionById(mockPermissionId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPermission', () => {
    const mockCreateDto = {
      resourceName: 'users',
      actionName: 'read',
      description: 'Allow reading users',
    };

    it('should create permission with generated name', async () => {
      const expectedPermission: PartialPermission = {
        ...mockCreateDto,
        id: '123',
        name: 'users:read',
      };
      permissionsService.create.mockResolvedValue(
        expectedPermission as Permission,
      );

      const result = await controller.createPermission(mockCreateDto);

      expect(result).toEqual(expectedPermission);
      expect(permissionsService.create).toHaveBeenCalledWith({
        ...mockCreateDto,
        name: 'users:read',
      });
    });

    it('should create permission with provided name', async () => {
      const dtoWithName = {
        ...mockCreateDto,
        name: 'custom:name',
      };
      const expectedPermission: PartialPermission = {
        ...dtoWithName,
        id: '123',
        name: 'custom:name',
      };
      permissionsService.create.mockResolvedValue(
        expectedPermission as Permission,
      );

      const result = await controller.createPermission(dtoWithName);

      expect(result.name).toBe('custom:name');
      expect(permissionsService.create).toHaveBeenCalledWith(dtoWithName);
    });
  });

  describe('updatePermission', () => {
    const mockPermissionId = '123';
    const mockUpdateDto = {
      description: 'Updated description',
    };

    it('should update permission', async () => {
      const updatedPermission: PartialPermission = {
        id: mockPermissionId,
        resourceName: 'users',
        actionName: 'read',
        name: 'users:read',
        description: 'Updated description',
      };
      permissionsService.update.mockResolvedValue(
        updatedPermission as Permission,
      );

      const result = await controller.updatePermission(
        mockPermissionId,
        mockUpdateDto,
      );

      expect(result).toEqual(updatedPermission);
      expect(permissionsService.update).toHaveBeenCalledWith(
        mockPermissionId,
        mockUpdateDto,
      );
    });

    it('should throw NotFoundException when permission not found', async () => {
      permissionsService.update.mockResolvedValue(null);

      await expect(
        controller.updatePermission(mockPermissionId, mockUpdateDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deletePermission', () => {
    const mockPermissionId = '123';

    it('should delete permission', async () => {
      permissionsService.delete.mockResolvedValue(true);

      const result = await controller.deletePermission(mockPermissionId);

      expect(result).toEqual({ deleted: true });
      expect(permissionsService.delete).toHaveBeenCalledWith(mockPermissionId);
    });

    it('should throw NotFoundException when permission not found', async () => {
      permissionsService.delete.mockResolvedValue(false);

      await expect(
        controller.deletePermission(mockPermissionId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('seedDefaultPermissions', () => {
    const mockRequest = createMockRequest({ id: 1 });

    it('should seed permissions for admin user', async () => {
      permissionsService.getUserRoles.mockResolvedValue([{ name: 'admin' }]);
      permissionsService.seedDefaultPermissions.mockResolvedValue(undefined);

      const result = await controller.seedDefaultPermissions(mockRequest);

      expect(result).toEqual({
        success: true,
        message: 'Default permissions seeded successfully',
      });
      expect(permissionsService.seedDefaultPermissions).toHaveBeenCalled();
    });

    it('should throw ForbiddenException for non-admin user', async () => {
      permissionsService.getUserRoles.mockResolvedValue([{ name: 'user' }]);

      await expect(
        controller.seedDefaultPermissions(mockRequest),
      ).rejects.toThrow('Only administrators can seed permissions');
    });
  });
});
