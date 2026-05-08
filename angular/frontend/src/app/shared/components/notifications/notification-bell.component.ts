import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatMenuModule } from '@angular/material/menu';
import { NotificationCenterService } from '../../../core/services/notification-center.service';
import { NotificationDropdownComponent } from './notification-dropdown.component';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatMenuModule,
    NotificationDropdownComponent
  ],
  template: `
    <button mat-icon-button [matMenuTriggerFor]="notificationMenu" aria-label="View notifications">
      <mat-icon [matBadge]="(unreadCount$ | async) || null" 
                matBadgeColor="warn" 
                [matBadgeHidden]="(unreadCount$ | async) === 0">
        notifications
      </mat-icon>
    </button>
    
    <mat-menu #notificationMenu="matMenu" xPosition="before" class="notification-menu-panel">
      <div (click)="$event.stopPropagation()">
        <app-notification-dropdown></app-notification-dropdown>
      </div>
    </mat-menu>
  `,
  styles: [`
    :host {
      display: inline-block;
    }

    ::ng-deep .notification-menu-panel {
      max-width: none !important;
      
      .mat-mdc-menu-content {
        padding: 0 !important;
      }
    }
  `]
})
export class NotificationBellComponent {
  unreadCount$: Observable<number>;

  constructor(private notificationService: NotificationCenterService) {
    this.unreadCount$ = this.notificationService.unreadCount$;
  }
}
