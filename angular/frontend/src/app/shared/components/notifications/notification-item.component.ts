import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Notification, NotificationType } from '../../../models/notification.model';

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule
  ],
  template: `
    <div class="notification-item" [class.unread]="!notification.isRead">
      <div class="notification-icon" [ngClass]="notification.type">
        <mat-icon>{{ getIcon() }}</mat-icon>
      </div>
      <div class="notification-content" (click)="onItemClick()">
        <div class="notification-header">
          <span class="notification-title">{{ notification.title }}</span>
          <span class="notification-time">{{ notification.createdAt | date:'short' }}</span>
        </div>
        <div class="notification-message">{{ notification.message }}</div>
      </div>
      <div class="notification-actions">
        <button mat-icon-button *ngIf="!notification.isRead" 
                (click)="onMarkAsRead($event)" 
                matTooltip="Mark as read">
          <mat-icon>done</mat-icon>
        </button>
        <button mat-icon-button (click)="onDelete($event)" 
                matTooltip="Delete">
          <mat-icon>delete_outline</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .notification-item {
      display: flex;
      padding: 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      transition: background-color 0.2s;
      cursor: pointer;
      position: relative;
      gap: 12px;

      &:hover {
        background-color: var(--mat-sys-surface-variant);
        
        .notification-actions {
          opacity: 1;
        }
      }

      &.unread {
        background-color: rgba(var(--mat-sys-primary-rgb, 103, 80, 164), 0.05);
        
        .notification-title {
          font-weight: 600;
        }

        &::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background-color: var(--mat-sys-primary);
        }
      }
    }

    .notification-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      flex-shrink: 0;
      background-color: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);

      &.privacy {
        background-color: rgba(var(--mat-sys-primary-rgb, 103, 80, 164), 0.1);
        color: var(--mat-sys-primary);
      }

      &.security {
        background-color: rgba(186, 26, 26, 0.1); // error color
        color: var(--mat-sys-error);
      }

      &.system {
        background-color: rgba(125, 82, 96, 0.1); // tertiary
        color: var(--mat-sys-tertiary);
      }

      &.info {
        background-color: rgba(33, 150, 243, 0.1);
        color: #2196f3;
      }
    }

    .notification-content {
      flex: 1;
      min-width: 0;
    }

    .notification-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 4px;
      gap: 8px;
    }

    .notification-title {
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .notification-time {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    .notification-message {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .notification-actions {
      display: flex;
      flex-direction: column;
      opacity: 0;
      transition: opacity 0.2s;
      
      button {
        width: 32px;
        height: 32px;
        line-height: 32px;
        
        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }
    }
  `]
})
export class NotificationItemComponent {
  @Input({ required: true }) notification!: Notification;
  @Output() read = new EventEmitter<number>();
  @Output() delete = new EventEmitter<number>();
  @Output() action = new EventEmitter<Notification>();

  getIcon(): string {
    switch (this.notification.type) {
      case NotificationType.PRIVACY: return 'policy';
      case NotificationType.SECURITY: return 'security';
      case NotificationType.SYSTEM: return 'settings_suggest';
      case NotificationType.INFO: return 'info';
      default: return 'notifications';
    }
  }

  onItemClick(): void {
    this.action.emit(this.notification);
  }

  onMarkAsRead(event: MouseEvent): void {
    event.stopPropagation();
    this.read.emit(this.notification.id);
  }

  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.delete.emit(this.notification.id);
  }
}
