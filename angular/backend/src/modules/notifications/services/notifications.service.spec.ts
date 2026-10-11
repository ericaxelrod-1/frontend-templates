import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationType } from '../entities/notification.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationRepo: Repository<Notification>;
  let preferenceRepo: Repository<NotificationPreference>;

  const mockNotificationRepo = {
    find: jest.fn(),
    count: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  };

  const mockPreferenceRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(Notification),
          useValue: mockNotificationRepo,
        },
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: mockPreferenceRepo,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    notificationRepo = module.get<Repository<Notification>>(
      getRepositoryToken(Notification),
    );
    preferenceRepo = module.get<Repository<NotificationPreference>>(
      getRepositoryToken(NotificationPreference),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForUser', () => {
    it('should return non-archived notifications for user', async () => {
      const mockNotifications = [{ id: 1, title: 'Test' }];
      mockNotificationRepo.find.mockResolvedValue(mockNotifications);

      const result = await service.findAllForUser(1);

      expect(result).toEqual(mockNotifications);
      expect(notificationRepo.find).toHaveBeenCalledWith({
        where: { userId: 1, isArchived: false },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count', async () => {
      mockNotificationRepo.count.mockResolvedValue(5);

      const result = await service.getUnreadCount(1);

      expect(result).toBe(5);
      expect(notificationRepo.count).toHaveBeenCalledWith({
        where: { userId: 1, isRead: false, isArchived: false },
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const mockNotification = { id: 1, userId: 1, isRead: false };
      mockNotificationRepo.findOne.mockResolvedValue(mockNotification);
      mockNotificationRepo.save.mockImplementation((n) => Promise.resolve(n));

      const result = await service.markAsRead(1, 1);

      expect(result.isRead).toBe(true);
      expect(result.readAt).toBeDefined();
      expect(notificationRepo.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if notification not found', async () => {
      mockNotificationRepo.findOne.mockResolvedValue(null);

      await expect(service.markAsRead(1, 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create notification considering preferences', async () => {
      const mockPreferences = { privacyEnabled: true };
      jest.spyOn(service, 'getPreferences').mockResolvedValue(mockPreferences as any);
      
      const createDto = {
        title: 'New Request',
        message: 'A new request has been submitted',
        type: NotificationType.PRIVACY,
      };

      const mockNotification = { ...createDto, userId: 1 };
      mockNotificationRepo.create.mockReturnValue(mockNotification);
      mockNotificationRepo.save.mockResolvedValue(mockNotification);

      const result = await service.create(1, createDto as any);

      expect(result).toEqual(mockNotification);
      expect(notificationRepo.create).toHaveBeenCalled();
      expect(notificationRepo.save).toHaveBeenCalled();
    });
  });
});
