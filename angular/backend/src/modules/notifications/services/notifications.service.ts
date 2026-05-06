import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../entities/notification.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { CreateNotificationDto, UpdateNotificationPreferenceDto } from '../dto/notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  async findAllForUser(userId: number): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { userId, isArchived: false },
      order: { createdAt: 'DESC' },
    });
  }

  async getUnreadCount(userId: number): Promise<number> {
    return this.notificationRepository.count({
      where: { userId, isRead: false, isArchived: false },
    });
  }

  async markAsRead(id: number, userId: number): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    notification.isRead = true;
    notification.readAt = new Date();
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: number): Promise<void> {
    await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
  }

  async remove(id: number, userId: number): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    notification.isArchived = true;
    await this.notificationRepository.save(notification);
  }

  async create(userId: number, createDto: CreateNotificationDto): Promise<Notification> {
    // Check user preferences
    const preferences = await this.getPreferences(userId);
    
    let isEnabled = true;
    switch (createDto.type) {
      case NotificationType.PRIVACY:
        isEnabled = preferences.privacyEnabled;
        break;
      case NotificationType.SECURITY:
        isEnabled = preferences.securityEnabled;
        break;
      case NotificationType.SYSTEM:
        isEnabled = preferences.systemEnabled;
        break;
      // Info is always enabled for now or falls under system
    }

    if (!isEnabled) {
      // Still create it but maybe don't send email (email logic would go here)
      // For now, we always store persistent notifications regardless of preferences
      // but preferences could control push/email in the future.
    }

    const notification = this.notificationRepository.create({
      ...createDto,
      userId,
    });

    return this.notificationRepository.save(notification);
  }

  async getPreferences(userId: number): Promise<NotificationPreference> {
    let preferences = await this.preferenceRepository.findOne({
      where: { userId },
    });

    if (!preferences) {
      preferences = this.preferenceRepository.create({
        userId,
      });
      preferences = await this.preferenceRepository.save(preferences);
    }

    return preferences;
  }

  async updatePreferences(
    userId: number,
    updateDto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    const preferences = await this.getPreferences(userId);
    Object.assign(preferences, updateDto);
    return this.preferenceRepository.save(preferences);
  }
}
