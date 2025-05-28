import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolesService } from './roles.service';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';
import { PermissionsService } from '../permissions/services/permissions.service';
import { ForbiddenException } from '@nestjs/common';

describe('RolesService', () => {
  let service: RolesService;
  let rolesRepository: Repository<Role>;
  let usersRepository: Repository<User>;
  let permissionsService: PermissionsService;

  const mockRolesRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  const mockUsersRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockPermissionsService = {
    assignPermissionsToRole: jest.fn(),
    hasPermission: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: getRepositoryToken(Role),
          useValue: mockRolesRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUsersRepository,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
    rolesRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    usersRepository = module.get<Repository<User>>(getRepositoryToken(User));
    permissionsService = module.get<PermissionsService>(PermissionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('should return a role by id', async () => {
      const role = {
        id: 1,
        name: 'User',
        permissions: ['users:view', 'content:view'],
      };
      mockRolesRepository.findOne.mockResolvedValue(role);

      expect(await service.findOne(1)).toBe(role);
      expect(mockRolesRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });
  });

  describe('updateRolePermissions', () => {
    it('should allow admin to update role permissions', async () => {
      const currentUser = {
        id: 1,
        username: 'admin',
        email: 'admin@example.com',
        password: 'hashed_password',
        isActive: true,
        isEmailVerified: true,
        lastLogin: new Date(),
        firstName: 'Admin',
        lastName: 'User',
        emailVerified: true,
        userDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: [],
        groups: [],
        userPermissions: [],
        tasks: [],
        categories: [],
        tags: [],
        userGroups: [],
        permissions: [],
        role: {
          name: 'Superadmin',
          permissions: ['roles:manage'],
        },
      } as unknown as User;
      const role = { id: 1, name: 'User', isSystemRole: false };
      const permissions = ['users:view', 'users:edit'];

      mockPermissionsService.hasPermission.mockResolvedValue(true);
      mockRolesRepository.findOne.mockResolvedValue(role);
      mockPermissionsService.assignPermissionsToRole.mockResolvedValue(
        undefined,
      );

      await service.updateRolePermissions(1, permissions, currentUser);

      expect(
        mockPermissionsService.assignPermissionsToRole,
      ).toHaveBeenCalledWith(1, permissions);
    });

    it('should not allow non-admin to update role permissions', async () => {
      const nonAdminUser = {
        id: 2,
        username: 'user',
        email: 'user@example.com',
        password: 'hashed_password',
        isActive: true,
        isEmailVerified: true,
        lastLogin: new Date(),
        firstName: 'Regular',
        lastName: 'User',
        emailVerified: true,
        userDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: [],
        groups: [],
        userPermissions: [],
        tasks: [],
        categories: [],
        tags: [],
        userGroups: [],
        permissions: [],
        role: {
          name: 'User',
          permissions: [],
        },
      } as unknown as User;
      mockPermissionsService.hasPermission.mockResolvedValue(false);

      await expect(
        service.updateRolePermissions(1, [], nonAdminUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
