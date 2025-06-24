import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from './services/permissions.service';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { GroupPermission } from './entities/group-permission.entity';
import { UserPermission } from './entities/user-permission.entity';
import { Role } from '../users/entities/role.entity';
import { Group } from './entities/group.entity';
import { User } from '../users/entities/user.entity';
import { UiComponent } from './entities/ui-component.entity';
import { FrontendRoute } from './entities/frontend-route.entity';
import { ApiEndpoint } from './entities/api-endpoint.entity';
import { CacheService } from '../cache/cache.service';
import { ManifestService } from './scanners/manifest.service';
import { ModuleRef } from '@nestjs/core';

type MockRepository<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const createMockRepository = <T = any>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
});

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionRepository: MockRepository<Permission>;
  let rolePermissionRepository: MockRepository<RolePermission>;
  let groupPermissionRepository: MockRepository<GroupPermission>;
  let userPermissionRepository: MockRepository<UserPermission>;
  let roleRepository: MockRepository<Role>;
  let groupRepository: MockRepository<Group>;
  let userRepository: MockRepository<User>;
  let componentRepository: MockRepository<UiComponent>;
  let routeRepository: MockRepository<FrontendRoute>;
  let endpointRepository: MockRepository<ApiEndpoint>;
  let cacheService: Partial<CacheService>;
  let manifestService: ManifestService;

  beforeEach(async () => {
    cacheService = {
      getUserPermissions: jest.fn(),
      cacheUserPermissions: jest.fn(),
    };

    manifestService = {
      scanAndUpdateRegistry: jest.fn(),
    } as unknown as ManifestService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: ModuleRef,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Permission),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(RolePermission),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(GroupPermission),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(UserPermission),
          useFactory: createMockRepository,
        },
        { provide: getRepositoryToken(Role), useFactory: createMockRepository },
        {
          provide: getRepositoryToken(Group),
          useFactory: createMockRepository,
        },
        { provide: getRepositoryToken(User), useFactory: createMockRepository },
        {
          provide: getRepositoryToken(UiComponent),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(FrontendRoute),
          useFactory: createMockRepository,
        },
        {
          provide: getRepositoryToken(ApiEndpoint),
          useFactory: createMockRepository,
        },
        { provide: CacheService, useValue: cacheService },
        { provide: ManifestService, useValue: manifestService },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
    permissionRepository = module.get(getRepositoryToken(Permission));
    rolePermissionRepository = module.get(getRepositoryToken(RolePermission));
    groupPermissionRepository = module.get(getRepositoryToken(GroupPermission));
    userPermissionRepository = module.get(getRepositoryToken(UserPermission));
    roleRepository = module.get(getRepositoryToken(Role));
    groupRepository = module.get(getRepositoryToken(Group));
    userRepository = module.get(getRepositoryToken(User));
    componentRepository = module.get(getRepositoryToken(UiComponent));
    routeRepository = module.get(getRepositoryToken(FrontendRoute));
    endpointRepository = module.get(getRepositoryToken(ApiEndpoint));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllPermissions', () => {
    it('should return all permissions', async () => {
      // Arrange
      const permissions = [
        { id: '1', resourceName: 'users', actionName: 'read' },
        { id: '2', resourceName: 'users', actionName: 'write' },
      ];
      permissionRepository.find.mockResolvedValue(permissions);

      // Act
      const result = await service.getAllPermissions();

      // Assert
      expect(permissionRepository.find).toHaveBeenCalled();
      expect(result).toEqual(permissions);
    });
  });

  describe('getUserPermissions', () => {
    it('should return cached permissions if available', async () => {
      // Arrange
      const userId = 1;
      const cachedPermissions = ['users:view', 'users:write'];
      (cacheService.getUserPermissions as jest.Mock).mockResolvedValue(
        cachedPermissions,
      );

      // Act
      const result = await service.getUserPermissions(userId);

      // Assert
      expect(cacheService.getUserPermissions).toHaveBeenCalledWith(userId);
      expect(result).toEqual(cachedPermissions);
    });

    it('should fetch permissions from database if not cached', async () => {
      // Arrange
      const userId = 1;
      (cacheService.getUserPermissions as jest.Mock).mockResolvedValue(null);

      const user = {
        id: userId,
        roles: [
          {
            id: 'role1',
            rolePermissions: [
              {
                permission: { resourceName: 'users', actionName: 'view' },
                granted: true,
              },
            ],
          },
        ],
        groups: [
          {
            id: 'group1',
            groupPermissions: [
              {
                permission: { resourceName: 'tasks', actionName: 'write' },
                granted: true,
              },
            ],
          },
        ],
        userPermissions: [
          {
            permission: { resourceName: 'projects', actionName: 'delete' },
            granted: true,
          },
        ],
      };

      userRepository.findOne.mockResolvedValue(user);

      // Act
      const result = await service.getUserPermissions(userId);

      // Assert
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        relations: [
          'roles',
          'roles.rolePermissions',
          'roles.rolePermissions.permission',
          'groups',
          'groups.groupPermissions',
          'groups.groupPermissions.permission',
          'userPermissions',
          'userPermissions.permission',
        ],
      });

      expect(result).toContain('users:view');
      expect(result).toContain('tasks:write');
      expect(result).toContain('projects:delete');
      expect(cacheService.cacheUserPermissions).toHaveBeenCalledWith(
        userId,
        expect.any(Array),
        expect.any(Number),
      );
    });
  });
});
