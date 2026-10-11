import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupsService } from './groups.service';
import { Group } from '../permissions/entities/group.entity';
import { User } from './entities/user.entity';
import { NotFoundException } from '@nestjs/common';

describe('GroupsService', () => {
  let service: GroupsService;
  let groupRepository: Repository<Group>;
  let userRepository: Repository<User>;

  const mockGroupRepository = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        {
          provide: getRepositoryToken(Group),
          useValue: mockGroupRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
    groupRepository = module.get<Repository<Group>>(getRepositoryToken(Group));
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated groups', async () => {
      const groups = [{ id: 1, name: 'Group 1' }];
      mockGroupRepository.findAndCount.mockResolvedValue([groups, 1]);

      const result = await service.findAll(0, 10);

      expect(result.items).toEqual(groups);
      expect(result.total).toBe(1);
      expect(mockGroupRepository.findAndCount).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a group', async () => {
      const group = { id: 1, name: 'Group 1' };
      mockGroupRepository.findOne.mockResolvedValue(group);

      const result = await service.findOne(1);
      expect(result).toEqual(group);
    });

    it('should throw NotFoundException if group not found', async () => {
      mockGroupRepository.findOne.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create and return a group', async () => {
      const name = 'New Group';
      const user = { id: 1 } as User;
      const group = { id: 1, name, ownerId: 1 };
      
      mockGroupRepository.create.mockReturnValue(group);
      mockGroupRepository.save.mockResolvedValue(group);
      mockGroupRepository.findOne.mockResolvedValue(group);

      const result = await service.create(name, 'desc', user);
      expect(result).toEqual(group);
      expect(mockGroupRepository.save).toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    it('should add user to group', async () => {
      const user = { id: 1, groups: [] } as any;
      const group = { id: 1, name: 'Group' } as any;
      
      mockUserRepository.findOne.mockResolvedValue(user);
      mockGroupRepository.findOne.mockResolvedValue(group);
      mockUserRepository.save.mockResolvedValue(user);

      const result = await service.addMember(1, 1);
      expect(result.success).toBe(true);
      expect(user.groups).toContain(group);
    });
  });
});
