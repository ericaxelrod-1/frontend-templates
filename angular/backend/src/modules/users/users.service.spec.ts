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
import { PasswordValidationService } from '../auth/password-validation.service';

// Mock bcrypt module
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: Repository<User>;
  let roleRepository: Repository<Role>;
  let passwordValidationService: PasswordValidationService;

  const mockUserRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn((entity) => entity),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const mockRoleRepository = {
    findOne: jest.fn(),
  };

  const mockPasswordValidationService = {
    validate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
          provide: PasswordValidationService,
          useValue: mockPasswordValidationService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    passwordValidationService = module.get<PasswordValidationService>(
      PasswordValidationService,
    );
  });

  describe('create', () => {
    const createUserDto = {
      email: 'test@example.com',
      password: 'Password123!',
      firstName: 'Test',
      lastName: 'User',
    };

    it('should successfully create a user', async () => {
      const defaultRole = { id: 1, name: 'user' };
      const hashedPassword = 'hashed-password';

      // Setup mocks
      mockUserRepository.findOne.mockResolvedValue(null);
      mockPasswordValidationService.validate.mockReturnValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockRoleRepository.findOne.mockResolvedValue(defaultRole);

      // Expected user with hashed password
      const expectedSavedUser = {
        ...createUserDto,
        password: hashedPassword,
        role: defaultRole,
      };
      mockUserRepository.save.mockResolvedValue(expectedSavedUser);

      // Call the service method
      const result = await service.create(createUserDto);

      // Verify the result contains expected data
      expect(result).toEqual(expectedSavedUser);

      // Verify repository interactions
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: createUserDto.email },
      });

      // Verify the user was created with correct data
      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: createUserDto.email,
          firstName: createUserDto.firstName,
          lastName: createUserDto.lastName,
          role: defaultRole,
        }),
      );

      // Verify user was saved
      expect(mockUserRepository.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if email already exists', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 1,
        email: createUserDto.email,
      });

      await expect(service.create(createUserDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockUserRepository.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if default role not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      mockPasswordValidationService.validate.mockReturnValue(true);
      mockRoleRepository.findOne.mockResolvedValue(null);

      mockUserRepository.save.mockImplementation(() => {
        throw new BadRequestException('Default role not found');
      });

      await expect(service.create(createUserDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return an array of users', async () => {
      const expectedUsers = [
        { id: 1, email: 'user1@example.com' },
        { id: 2, email: 'user2@example.com' },
      ];
      mockUserRepository.find.mockResolvedValue(expectedUsers);

      const result = await service.findAll();

      expect(result).toEqual(expectedUsers);
      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: {},
        select: [
          'id',
          'email',
          'firstName',
          'lastName',
          'createdAt',
          'updatedAt',
        ],
        relations: ['role'],
      });
    });

    it('should filter users by search term', async () => {
      const search = 'search';
      const expectedUsers = [{ id: 1, email: 'search@example.com' }];
      mockUserRepository.find.mockResolvedValue(expectedUsers);

      const result = await service.findAll(search);

      expect(result).toEqual(expectedUsers);
      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: { email: expect.anything() },
        select: [
          'id',
          'email',
          'firstName',
          'lastName',
          'createdAt',
          'updatedAt',
        ],
        relations: ['role'],
      });
    });
  });

  describe('findOne', () => {
    it('should find a user by id', async () => {
      const userId = 1;
      const expectedUser = { id: userId, email: 'test@example.com' };
      mockUserRepository.findOne.mockResolvedValue(expectedUser);

      const result = await service.findOne(userId);

      expect(result).toEqual(expectedUser);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        relations: ['role'],
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      const userId = 999;
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      const email = 'test@example.com';
      const expectedUser = { id: 1, email };
      mockUserRepository.findOne.mockResolvedValue(expectedUser);

      const result = await service.findByEmail(email);

      expect(result).toEqual(expectedUser);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email },
        relations: ['role'],
      });
    });

    it('should return undefined if user not found by email', async () => {
      const email = 'nonexistent@example.com';
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmail(email);

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    const userId = 1;
    const updateUserDto = {
      firstName: 'Updated',
      lastName: 'User',
    };

    it('should update a user successfully', async () => {
      const existingUser = {
        id: userId,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
      };
      const updatedUser = { ...existingUser, ...updateUserDto };

      mockUserRepository.findOne.mockResolvedValue(existingUser);
      mockUserRepository.save.mockResolvedValue(updatedUser);

      const result = await service.update(userId, updateUserDto);

      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        relations: ['role'],
      });
      expect(mockUserRepository.save).toHaveBeenCalled();
    });

    it('should hash password if provided in update', async () => {
      const existingUser = {
        id: userId,
        email: 'test@example.com',
      };
      const updateWithPassword = {
        ...updateUserDto,
        password: 'NewPassword123!',
      };
      const hashedPassword = 'hashed-new-password';

      // Setup mocks
      mockUserRepository.findOne.mockResolvedValue(existingUser);
      mockPasswordValidationService.validate.mockReturnValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

      // Expected saved user
      const expectedSavedUser = {
        ...existingUser,
        ...updateUserDto,
        password: hashedPassword,
      };
      mockUserRepository.save.mockResolvedValue(expectedSavedUser);

      // Call service
      const result = await service.update(userId, updateWithPassword);

      // Verify the result contains expected data
      expect(result).toEqual(expectedSavedUser);
      expect(result.password).toEqual(hashedPassword);
    });

    it('should throw NotFoundException if user to update not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.update(userId, updateUserDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should remove a user successfully', async () => {
      const userId = 1;
      const user = { id: userId, email: 'test@example.com' };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.remove.mockResolvedValue(undefined);

      await service.remove(userId);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        relations: ['role'],
      });
      expect(mockUserRepository.remove).toHaveBeenCalledWith(user);
    });

    it('should throw NotFoundException if user to remove not found', async () => {
      const userId = 999;
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateLastLogin', () => {
    it('should update lastLogin timestamp', async () => {
      const userId = 1;
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      await service.updateLastLogin(userId);

      expect(mockUserRepository.update).toHaveBeenCalledWith(userId, {
        lastLogin: expect.any(Date),
      });
    });
  });

  describe('setRole', () => {
    it('should set a user role', async () => {
      const userId = 1;
      const roleId = 2;
      const user = { id: userId, email: 'test@example.com' };
      const role = { id: roleId, name: 'admin' };
      const updatedUser = { ...user, role };

      mockUserRepository.findOne.mockResolvedValue(user);
      mockRoleRepository.findOne.mockResolvedValue(role);
      mockUserRepository.save.mockResolvedValue(updatedUser);

      const result = await service.setRole(userId, roleId);

      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: userId },
        relations: ['role'],
      });
      expect(mockRoleRepository.findOne).toHaveBeenCalledWith({
        where: { id: roleId },
      });
      expect(mockUserRepository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.setRole(1, 2)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if role not found', async () => {
      const userId = 1;
      const roleId = 999;
      mockUserRepository.findOne.mockResolvedValue({ id: userId });
      mockRoleRepository.findOne.mockResolvedValue(null);

      await expect(service.setRole(userId, roleId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchUsers', () => {
    it('should search users by email, firstName, or lastName', async () => {
      const query = 'search';
      const expectedUsers = [
        { id: 1, email: 'search@example.com' },
        { id: 2, firstName: 'Search', lastName: 'User' },
      ];
      mockUserRepository.find.mockResolvedValue(expectedUsers);

      const result = await service.searchUsers(query);

      expect(result).toEqual(expectedUsers);
      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: expect.arrayContaining([
          { email: expect.anything() },
          { firstName: expect.anything() },
          { lastName: expect.anything() },
        ]),
        select: ['id', 'email', 'firstName', 'lastName'],
      });
    });
  });
});
