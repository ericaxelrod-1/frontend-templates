import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard, PERMISSIONS_KEY } from './permission.guard';

// Create a mock interface to prevent direct import of PermissionsService
interface MockPermissionsService {
  checkUserPermission: jest.Mock;
  getRoleNamesForUser: jest.Mock;
}

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let permissionsService: MockPermissionsService;

  // Mocks
  const mockRequest = {
    user: { id: 1 },
  };

  const mockExecutionContext = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockRequest),
    }),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionGuard,
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: 'PermissionsService',
          useValue: {
            checkUserPermission: jest.fn(),
            getRoleNamesForUser: jest.fn().mockReturnValue(['user']),
          },
        },
      ],
    }).compile();

    guard = module.get<PermissionGuard>(PermissionGuard);
    reflector = module.get<Reflector>(Reflector);
    permissionsService = module.get(
      'PermissionsService',
    ) as MockPermissionsService;
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access when no permissions are required', async () => {
    // Arrange
    jest.spyOn(reflector, 'get').mockReturnValue(null);

    // Act
    const result = await guard.canActivate(mockExecutionContext);

    // Assert
    expect(result).toBe(true);
  });

  it('should allow access when empty permission array is provided', async () => {
    // Arrange
    jest.spyOn(reflector, 'get').mockReturnValue([]);

    // Act
    const result = await guard.canActivate(mockExecutionContext);

    // Assert
    expect(result).toBe(true);
  });

  it('should throw UnauthorizedException if no user is found in request', async () => {
    // Arrange
    jest.spyOn(reflector, 'get').mockReturnValue(['users:read']);

    const customContext = {
      ...mockExecutionContext,
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user: undefined }),
      }),
    } as unknown as ExecutionContext;

    // Act & Assert
    await expect(guard.canActivate(customContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should allow access if user has any required permission', async () => {
    // Arrange
    jest.spyOn(reflector, 'get').mockReturnValue(['users:read', 'users:write']);
    permissionsService.checkUserPermission
      .mockResolvedValueOnce(false) // First permission check fails
      .mockResolvedValueOnce(true); // Second permission check succeeds

    // Act
    const result = await guard.canActivate(mockExecutionContext);

    // Assert
    expect(result).toBe(true);
    expect(permissionsService.checkUserPermission).toHaveBeenCalledTimes(2);
    expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
      1,
      'users',
      'read',
    );
    expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
      1,
      'users',
      'write',
    );
  });

  it('should throw UnauthorizedException if user does not have any required permission', async () => {
    // Arrange
    jest.spyOn(reflector, 'get').mockReturnValue(['users:read']);
    permissionsService.checkUserPermission.mockResolvedValue(false);

    // Act & Assert
    await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
      1,
      'users',
      'read',
    );
  });

  it('should handle ALL case where all permissions are required', async () => {
    // Arrange
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ all: ['users:read', 'roles:read'] });
    permissionsService.checkUserPermission
      .mockResolvedValueOnce(true) // First permission check succeeds
      .mockResolvedValueOnce(true); // Second permission check succeeds

    // Act
    const result = await guard.canActivate(mockExecutionContext);

    // Assert
    expect(result).toBe(true);
    expect(permissionsService.checkUserPermission).toHaveBeenCalledTimes(2);
  });

  it('should throw UnauthorizedException if user does not have all required permissions in ALL case', async () => {
    // Arrange
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ all: ['users:read', 'roles:read'] });
    permissionsService.checkUserPermission
      .mockResolvedValueOnce(true) // First permission check succeeds
      .mockResolvedValueOnce(false); // Second permission check fails

    // Act & Assert
    await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(permissionsService.checkUserPermission).toHaveBeenCalledTimes(2);
  });

  it('should throw BadRequestException for role-based permissions', async () => {
    // Arrange
    jest.spyOn(reflector, 'get').mockReturnValue(['role:user']);

    // Act & Assert
    await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
      BadRequestException,
    );
    // Role-based permission check shouldn't be called anymore
    expect(permissionsService.getRoleNamesForUser).not.toHaveBeenCalled();
  });

  it('should combine permissions from handler and controller', async () => {
    // Arrange
    jest
      .spyOn(reflector, 'get')
      .mockReturnValueOnce(['users:write']) // Handler permissions
      .mockReturnValueOnce(['users:read']); // Controller permissions

    permissionsService.checkUserPermission
      .mockResolvedValueOnce(false) // First permission check fails
      .mockResolvedValueOnce(true); // Second permission check succeeds

    // Act
    const result = await guard.canActivate(mockExecutionContext);

    // Assert
    expect(result).toBe(true);
    expect(permissionsService.checkUserPermission).toHaveBeenCalledTimes(2);
    expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
      1,
      'users',
      'write',
    );
    expect(permissionsService.checkUserPermission).toHaveBeenCalledWith(
      1,
      'users',
      'read',
    );
  });
});
