import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../services/notifications.service';
import { AuthGuard } from '@nestjs/passport';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: NotificationsService;

  const mockNotificationsService = {
    findAllForUser: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    remove: jest.fn(),
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getNotifications', () => {
    it('should call service.findAllForUser with user id', async () => {
      const mockReq = { user: { id: 1 } };
      await controller.getNotifications(mockReq as any);
      expect(service.findAllForUser).toHaveBeenCalledWith(1);
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count from service', async () => {
      const mockReq = { user: { id: 1 } };
      mockNotificationsService.getUnreadCount.mockResolvedValue(3);
      const result = await controller.getUnreadCount(mockReq as any);
      expect(result).toEqual({ count: 3 });
      expect(service.getUnreadCount).toHaveBeenCalledWith(1);
    });
  });

  describe('markAsRead', () => {
    it('should call service.markAsRead', async () => {
      const mockReq = { user: { id: 1 } };
      await controller.markAsRead(mockReq as any, 123);
      expect(service.markAsRead).toHaveBeenCalledWith(123, 1);
    });
  });

  describe('markAllAsRead', () => {
    it('should call service.markAllAsRead', async () => {
      const mockReq = { user: { id: 1 } };
      await controller.markAllAsRead(mockReq as any);
      expect(service.markAllAsRead).toHaveBeenCalledWith(1);
    });
  });

  describe('deleteNotification', () => {
    it('should call service.remove', async () => {
      const mockReq = { user: { id: 1 } };
      await controller.deleteNotification(mockReq as any, 123);
      expect(service.remove).toHaveBeenCalledWith(123, 1);
    });
  });

  describe('getPreferences', () => {
    it('should call service.getPreferences', async () => {
      const mockReq = { user: { id: 1 } };
      await controller.getPreferences(mockReq as any);
      expect(service.getPreferences).toHaveBeenCalledWith(1);
    });
  });

  describe('updatePreferences', () => {
    it('should call service.updatePreferences', async () => {
      const mockReq = { user: { id: 1 } };
      const dto = { emailEnabled: true };
      await controller.updatePreferences(mockReq as any, dto as any);
      expect(service.updatePreferences).toHaveBeenCalledWith(1, dto);
    });
  });
});
