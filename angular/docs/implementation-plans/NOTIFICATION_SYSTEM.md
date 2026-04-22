# Notification System Implementation Plan

## Overview

Universal notification system for the Angular application that allows any service to push notifications to users. Provides a bell icon in the header with a dropdown panel showing notifications, each linking to appropriate pages.

## Current State

- **Existing**: `NotificationService` at `frontend/src/app/core/services/notification.service.ts` - wraps MatSnackBar for toast messages (success/error/warning/info)
- **To be kept**: Toast functionality for transient success/error messages
- **New**: Notification center with persistent notifications, unread counts, and bell icon

---

## Architecture

### Services

| Service | Purpose | Location |
|---------|---------|----------|
| `ToastService` | Transient success/error/warning/info popups | Renamed from existing NotificationService |
| `NotificationCenterService` | Persistent notifications, unread tracking | New |
| `NotificationBackendService` | Backend API for notifications | New |

### Frontend Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `NotificationBellComponent` | Bell icon with badge in header | New |
| `NotificationDropdownComponent` | Dropdown panel with notification list | New |
| `NotificationItemComponent` | Individual notification display | New |

### Backend Entities

| Entity | Purpose | Location |
|--------|---------|----------|
| `Notification` | Stored notification record | New entity |
| `NotificationPreference` | User notification settings | New entity |

---

## Entity Schemas

### Notification Entity

**File**: `backend/src/modules/notifications/entities/notification.entity.ts`

```typescript
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: ['privacy', 'security', 'system', 'info'] })
  type: NotificationType;

  @Column()
  title: string;

  @Column('text')
  message: string;

  @Column({ nullable: true })
  link: string;

  @Column({ default: false })
  isRead: boolean;

  @Column({ nullable: true })
  readAt: Date;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ nullable: true })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
```

### NotificationPreference Entity

**File**: `backend/src/modules/notifications/entities/notification-preference.entity.ts`

```typescript
@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ default: true })
  emailEnabled: boolean;

  @Column({ default: true })
  privacyEnabled: boolean;

  @Column({ default: true })
  securityEnabled: boolean;

  @Column({ default: true })
  systemEnabled: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

---

## Backend Endpoints

### Notifications Controller

**File**: `backend/src/modules/notifications/notifications.controller.ts`

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | /notifications | List user's notifications | Yes |
| GET | /notifications/unread-count | Get unread count | Yes |
| PATCH | /notifications/:id/read | Mark as read | Yes |
| PATCH | /notifications/read-all | Mark all as read | Yes |
| DELETE | /notifications/:id | Delete notification | Yes |
| GET | /notifications/preferences | Get preferences | Yes |
| PATCH | /notifications/preferences | Update preferences | Yes |

---

## Frontend Services

### NotificationCenterService

**File**: `frontend/src/app/core/services/notification-center.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  private notifications$ = new BehaviorSubject<Notification[]>([]);
  private unreadCount$ = new BehaviorSubject<number>(0);

  // Methods
  getNotifications(): Observable<Notification[]>
  getUnreadCount(): Observable<number>
  markAsRead(id: number): Observable<void>
  markAllAsRead(): Observable<void>
  deleteNotification(id: number): Observable<void>
  
  // For services to push notifications
  pushNotification(notification: NotificationInput): void
  
  // Preferences
  getPreferences(): Observable<NotificationPreferences>
  updatePreferences(prefs: Partial<NotificationPreferences>): Observable<void>
}
```

---

## Notification Types & Triggers

| Type | Trigger | Default Enabled | Link Target |
|------|---------|------------------|-------------|
| privacy | New privacy ticket submitted | Yes | `/app/admin/privacy-requests` |
| privacy | SLA warning (24h before deadline) | Yes | `/app/admin/privacy-requests` |
| privacy | SLA breach | Yes | `/app/admin/privacy-requests` |
| security | New security alert | Yes | `/app/admin/security-alerts` |
| security | Login from new device | Yes | `/app/profile/security` |
| system | System maintenance | Yes | None |
| info | Generic info | Yes | Configurable |

---

## Implementation Tasks

### Phase 1: Backend

- [ ] Create notifications module directory
- [ ] Add Notification and NotificationPreference entities
- [ ] Create notifications service
- [ ] Create notifications controller
- [ ] Add to app.module.ts

### Phase 2: Frontend Services

- [ ] Create NotificationCenterService
- [ ] Integrate with backend API

### Phase 3: Frontend Components

- [ ] Create NotificationBellComponent
- [ ] Create NotificationDropdownComponent
- [ ] Add to header component

### Phase 4: Integration

- [ ] Connect privacy ticket system to push notifications
- [ ] Connect security alerts to push notifications

---

## Environment Variables

```bash
# Notification retention (days)
NOTIFICATION_RETENTION_DAYS=30
```

---

## Dependencies

- @angular/material (already used)
- NgRx or BehaviorSubject for state management
- Existing user authentication

---

## Migration Path

When privacy ticket system sends notifications:

```typescript
constructor(private notificationService: NotificationCenterService) {}

async onTicketCreated(ticket: PrivacyTicket) {
  await this.notificationService.pushNotification({
    type: 'privacy',
    title: 'New Privacy Request',
    message: `New ${ticket.requestType} request from ${ticket.email || 'user'}`,
    link: '/app/admin/privacy-requests'
  });
}
```