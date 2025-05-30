import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupsService } from './groups.service';
import { Group } from '../permissions/entities/group.entity';
import { User } from './entities/user.entity';
import { PermissionsService } from '../permissions/services/permissions.service';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

describe('GroupsService', () => {
  let service: GroupsService;
  let groupsRepository: Repository<Group>;
  let usersRepository: Repository<User>;
  let permissionsService: PermissionsService;

  const mockGroupsRepository = {
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
    assignPermissionsToGroup: jest.fn(),
    hasPermission: jest.fn(),
  };

  const createTestUser = (overrides = {}) =>
    ({
      id: 1,
      username: 'testuser',
      email: 'test@example.com',
      password: 'hashed_password',
      isActive: true,
      isEmailVerified: true,
      lastLogin: new Date(),
      firstName: 'Test',
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
      ...overrides,
    }) as unknown as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        {
          provide: getRepositoryToken(Group),
          useValue: mockGroupsRepository,
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

    service = module.get<GroupsService>(GroupsService);
    groupsRepository = module.get<Repository<Group>>(getRepositoryToken(Group));
    usersRepository = module.get<Repository<User>>(getRepositoryToken(User));
    permissionsService = module.get<PermissionsService>(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const currentUser = {
      id: 1,
      role: { name: 'User', permissions: { canManageGroups: true } },
    };

    it('should create a new group', async () => {
      const name = 'Test Group';
      const description = 'Test Description';
      const newGroup = {
        id: 1,
        name,
        description,
        owner: currentUser,
        settings: {
          canShareData: true,
          canShareAssets: true,
          maxMembers: 50,
        },
      };
      mockGroupsRepository.save.mockResolvedValue(newGroup);

      const result = await service.create(
        name,
        description,
        currentUser as User,
      );
      expect(result).toEqual(newGroup);
      expect(mockGroupsRepository.save).toHaveBeenCalledWith({
        name,
        description,
        owner: currentUser,
        settings: {
          canShareData: true,
          canShareAssets: true,
          maxMembers: 50,
        },
      });
    });
  });

  describe('findAll', () => {
    const currentUser = { id: 1, role: { name: 'User' } };

    it('should return all accessible groups for user', async () => {
      const groups = [
        { id: 1, name: 'Group 1' },
        { id: 2, name: 'Group 2' },
      ];
      mockGroupsRepository.find.mockResolvedValue(groups);

      const result = await service.findAll(currentUser as User);
      expect(result).toEqual(groups);
      expect(mockGroupsRepository.find).toHaveBeenCalledWith({
        where: [
          { owner: { id: currentUser.id } },
          { userGroups: { user: { id: currentUser.id } } },
        ],
        relations: ['owner', 'userGroups', 'userGroups.user'],
      });
    });
  });

  describe('findOne', () => {
    const currentUser = { id: 1, role: { name: 'User' } };

    it('should return a group by id if user has access', async () => {
      const group = {
        id: 1,
        name: 'Test Group',
        owner: currentUser,
        userGroups: [{ user: { id: currentUser.id } }],
      };
      mockGroupsRepository.findOne.mockResolvedValue(group);

      const result = await service.findOne(1, currentUser as User);
      expect(result).toEqual(group);
      expect(mockGroupsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['owner', 'userGroups', 'userGroups.user'],
      });
    });

    it('should throw NotFoundException when group not found', async () => {
      mockGroupsRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(999, currentUser as User)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user has no access', async () => {
      const group = {
        id: 1,
        name: 'Test Group',
        owner: { id: 2 },
        userGroups: [],
      };
      mockGroupsRepository.findOne.mockResolvedValue(group);

      await expect(service.findOne(1, currentUser as User)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('addMember', () => {
    const currentUser = { id: 1, role: { name: 'User' } };
    const groupId = 1;
    const userId = 2;

    it('should add a member to the group', async () => {
      const group = {
        id: groupId,
        name: 'Test Group',
        owner: currentUser,
        userGroups: [],
      };
      const user = { id: userId, name: 'Test User' };
      mockGroupsRepository.findOne.mockResolvedValue(group);
      mockUsersRepository.findOne.mockResolvedValue(user);
      mockGroupsRepository.findOne.mockResolvedValue(null);
      mockGroupsRepository.save.mockResolvedValue({ group, user });

      const result = await service.addMember(
        groupId,
        userId,
        currentUser as User,
      );
      expect(result).toBeDefined();
      expect(mockGroupsRepository.save).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not authorized', async () => {
      const group = {
        id: groupId,
        name: 'Test Group',
        owner: { id: 3 },
        userGroups: [],
      };
      mockGroupsRepository.findOne.mockResolvedValue(group);

      await expect(
        service.addMember(groupId, userId, currentUser as User),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    const currentUser = { id: 1, role: { name: 'User' } };
    const groupId = 1;
    const userId = 2;

    it('should remove a member from the group', async () => {
      const group = {
        id: groupId,
        name: 'Test Group',
        owner: currentUser,
        userGroups: [],
      };
      const userGroup = { id: 1, group, user: { id: userId } };
      mockGroupsRepository.findOne.mockResolvedValue(group);
      mockGroupsRepository.remove.mockResolvedValue(undefined);

      await service.removeMember(groupId, userId, currentUser as User);
      expect(mockGroupsRepository.remove).toHaveBeenCalledWith(group);
    });

    it('should throw ForbiddenException when user is not authorized', async () => {
      const group = {
        id: groupId,
        name: 'Test Group',
        owner: { id: 3 },
        userGroups: [],
      };
      mockGroupsRepository.findOne.mockResolvedValue(group);

      await expect(
        service.removeMember(groupId, userId, currentUser as User),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    const currentUser = { id: 1, role: { name: 'User' } };
    const groupId = 1;

    it('should delete a group', async () => {
      const group = {
        id: groupId,
        name: 'Test Group',
        owner: currentUser,
        userGroups: [],
      };
      mockGroupsRepository.findOne.mockResolvedValue(group);
      mockGroupsRepository.remove.mockResolvedValue(undefined);

      await service.delete(groupId, currentUser as User);
      expect(mockGroupsRepository.remove).toHaveBeenCalledWith(group);
    });

    it('should throw ForbiddenException when user is not authorized', async () => {
      const group = {
        id: groupId,
        name: 'Test Group',
        owner: { id: 3 },
        userGroups: [],
      };
      mockGroupsRepository.findOne.mockResolvedValue(group);

      await expect(
        service.delete(groupId, currentUser as User),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateGroupPermissions', () => {
    it('should allow admin to update group permissions', async () => {
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
          name: 'Admin',
          permissions: ['groups:manage'],
        },
      } as unknown as User;
      const group = { id: 1, name: 'Developers' };
      const permissions = ['projects:view', 'projects:edit', 'code:review'];

      mockPermissionsService.hasPermission.mockResolvedValue(true);
      mockGroupsRepository.findOne.mockResolvedValue(group);
      mockPermissionsService.assignPermissionsToGroup.mockResolvedValue(
        undefined,
      );

      await service.updateGroupPermissions(1, permissions, currentUser);

      expect(
        mockPermissionsService.assignPermissionsToGroup,
      ).toHaveBeenCalledWith(1, permissions);
    });

    it('should not allow non-admin to update group permissions', async () => {
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
        service.updateGroupPermissions(1, [], nonAdminUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
