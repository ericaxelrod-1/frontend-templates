export enum NotificationType {
  PRIVACY = 'privacy',
  SECURITY = 'security',
  SYSTEM = 'system',
  INFO = 'info',
}

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  readAt?: Date;
  isArchived: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

export interface NotificationPreference {
  id: number;
  userId: number;
  type: NotificationType;
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
}
