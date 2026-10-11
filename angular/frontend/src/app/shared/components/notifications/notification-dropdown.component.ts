import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NotificationCenterService } from '../../../core/services/notification-center.service';
import { NotificationItemComponent } from './notification-item.component';
import { Notification } from '../../../models/notification.model';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-notification-dropdown',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatProgressSpinnerModule,
    NotificationItemComponent
  ],
  template: `
    <div class="notification-dropdown">
      <div class="dropdown-header">
        <h3>Notifications</h3>
        <button mat-button color="primary" (click)="markAllAsRead()" *ngIf="(unreadCount$ | async) ?? 0 > 0">
          Mark all as read
        </button>
      </div>
      <mat-divider></mat-divider>
      
      <div class="dropdown-content">
        <ng-container *ngIf="notifications$ | async as notifications; else loading">
          <div *ngIf="notifications.length > 0; else emptyState">
            <app-notification-item 
              *ngFor="let notification of notifications"
              [notification]="notification"
              (read)="markAsRead($event)"
              (delete)="deleteNotification($event)"
              (action)="handleAction($event)">
            </app-notification-item>
          </div>
        </ng-container>
        
        <ng-template #emptyState>
          <div class="empty-state">
            <mat-icon>notifications_none</mat-icon>
            <p>You have no notifications</p>
          </div>
        </ng-template>
        
        <ng-template #loading>
          <div class="loading-state">
            <mat-spinner diameter="32"></mat-spinner>
          </div>
        </ng-template>
      </div>
      
      <mat-divider></mat-divider>
      <div class="dropdown-footer">
        <button mat-button (click)="viewAll()">View all notifications</button>
      </div>
    </div>
  `,
  styles: [`
    .notification-dropdown {
      width: 360px;
      max-width: 90vw;
      background-color: var(--mat-sys-surface);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--mat-sys-shadow);
    }

    .dropdown-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      
      h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 500;
      }

      button {
        font-size: 0.8rem;
      }
    }

    .dropdown-content {
      max-height: 400px;
      overflow-y: auto;
      min-height: 100px;
    }

    .empty-state, .loading-state {
      padding: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--mat-sys-on-surface-variant);
      
      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 8px;
        opacity: 0.5;
      }

      p {
        margin: 0;
        font-size: 0.9rem;
      }
    }

    .dropdown-footer {
      display: flex;
      justify-content: center;
      padding: 4px;

      button {
        width: 100%;
        color: var(--mat-sys-primary);
      }
    }
  `]
})
export class NotificationDropdownComponent implements OnInit {
  notifications$: Observable<Notification[]>;
  unreadCount$: Observable<number>;

  constructor(
    private notificationService: NotificationCenterService,
    private router: Router
  ) {
    this.notifications$ = this.notificationService.notifications$;
    this.unreadCount$ = this.notificationService.unreadCount$;
  }

  ngOnInit(): void {
    this.notificationService.fetchNotifications().subscribe();
  }

  markAsRead(id: number): void {
    this.notificationService.markAsRead(id).subscribe();
  }

  markAllAsRead(): void {
    this.notificationService.markAllAsRead().subscribe();
  }

  deleteNotification(id: number): void {
    this.notificationService.deleteNotification(id).subscribe();
  }

  handleAction(notification: Notification): void {
    if (!notification.isRead) {
      this.markAsRead(notification.id);
    }
    
    if (notification.link) {
      this.router.navigateByUrl(notification.link);
    }
  }

  viewAll(): void {
    this.router.navigate(['/app/notifications']);
  }
}
