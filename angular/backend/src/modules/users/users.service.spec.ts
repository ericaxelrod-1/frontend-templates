import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Group } from '../permissions/entities/group.entity';
import { PasswordValidationService } from '../auth/password-validation.service';
import { PermissionsService } from '../permissions/services/permissions.service';

// Mock bcrypt module
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: Repository<User>;
  let roleRepository: Repository<Role>;
  let groupRepository: Repository<Group>;
  let passwordValidationService: PasswordValidationService;
  let permissionsService: PermissionsService;

  let mockUserRepository: any;
  let mockRoleRepository: any;
  let mockGroupRepository: any;
  let mockPasswordValidationService: any;
  let mockPermissionsService: any;

  beforeEach(async () => {
    mockUserRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((entity) => ({ ...entity })),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: 1 })),
      update: jest.fn(),
      remove: jest.fn(),
      count: jest.fn(),
      userExistsCheck: jest.fn(),
    };

    mockRoleRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockGroupRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    mockPasswordValidationService = {
      validate: jest.fn(),
    };

    mockPermissionsService = {
      checkUserPermission: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: mockRoleRepository,
        },
        {
          provide: getRepositoryToken(Group),
          useValue: mockGroupRepository,
        },
        {
          provide: PasswordValidationService,
          useValue: mockPasswordValidationService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    groupRepository = module.get<Repository<Group>>(getRepositoryToken(Group));
    passwordValidationService = module.get<PasswordValidationService>(
      PasswordValidationService,
    );
    permissionsService = module.get<PermissionsService>(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createUserDto = {
      email: 'test@example.com',
      username: 'testuser',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User',
    };

    it('should successfully create a user', async () => {
      const defaultRole = { id: 1, name: 'user' };
      const hashedPassword = 'hashed-password';

      // 1. userExistsCheck calls count() -> return 0
      mockUserRepository.count.mockResolvedValue(0);
      
      // 2. findOne({ where: { email } }) -> return null
      // 3. findOne({ where: { username } }) -> return null
      // 5. findOne({ where: { id }, relations: [...] }) -> return user
      const savedUser = { ...createUserDto, id: 1, password: hashedPassword, roles: [defaultRole] };
      mockUserRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(savedUser);
        
      mockPasswordValidationService.validate.mockReturnValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockRoleRepository.findOne.mockResolvedValue(defaultRole);
      
      mockUserRepository.save.mockResolvedValue(savedUser);

      const result = await service.create(createUserDto);

      expect(result).toBeDefined();
      expect(result!.id).toBe(1);
      expect(mockUserRepository.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all users with correct relations', async () => {
      const users = [{ id: 1, email: 'test@example.com' }];
      mockUserRepository.find.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual(users);
      expect(mockUserRepository.find).toHaveBeenCalledWith(expect.objectContaining({
        relations: ['roles', 'groups']
      }));
    });
  });

  describe('findByEmail', () => {
    it('should find user by email with extensive relations and fields', async () => {
      const email = 'test@example.com';
      const user = { id: 1, email };
      mockUserRepository.findOne.mockResolvedValue(user);

      const result = await service.findByEmail(email);

      expect(result).toEqual(user);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith(expect.objectContaining({
        where: { email },
        relations: expect.arrayContaining(['roles', 'groups'])
      }));
    });
  });

  describe('updateLastLogin', () => {
    it('should update lastLoginAt property', async () => {
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      await service.updateLastLogin(1);

      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        lastLoginAt: expect.any(Date)
      });
    });
  });
});
