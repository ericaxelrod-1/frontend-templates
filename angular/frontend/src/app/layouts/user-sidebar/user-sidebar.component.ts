import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { Store } from '@ngxs/store';
import { AuthActions } from '../../store/auth/auth.state';
import { User } from '../../models';
import { LoggerService } from '../../services/logging/logger.service';
import { AuthService } from '../../core/services/auth.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-user-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule
  ],
  template: `
    <div class="user-sidebar" [class.sidebar-open]="isOpen">
      <div class="sidebar-header">
        <div class="user-info">
          <mat-icon class="user-avatar">account_circle</mat-icon>
          <div class="user-details">
            <h3>{{ getDisplayName(currentUser$ | async) }}</h3>
            <p class="user-email">{{ (currentUser$ | async)?.email }}</p>
          </div>
        </div>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <mat-divider></mat-divider>
      
      <mat-nav-list>
        <a mat-list-item (click)="navigateToProfile()">
          <mat-icon matListItemIcon>person</mat-icon>
          <span matListItemTitle>Profile</span>
        </a>
        
        <a mat-list-item (click)="navigateToSettings()">
          <mat-icon matListItemIcon>settings</mat-icon>
          <span matListItemTitle>Account Settings</span>
        </a>
        
        <a mat-list-item (click)="navigateToChangePassword()">
          <mat-icon matListItemIcon>lock</mat-icon>
          <span matListItemTitle>Change Password</span>
        </a>
        
        <mat-divider></mat-divider>
        
        <a mat-list-item (click)="logout()">
          <mat-icon matListItemIcon>logout</mat-icon>
          <span matListItemTitle>Logout</span>
        </a>
      </mat-nav-list>
    </div>
    
    <div class="sidebar-backdrop" 
         [class.backdrop-visible]="isOpen" 
         (click)="close()"></div>
  `,
  styleUrls: ['./user-sidebar.component.scss']
})
export class UserSidebarComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() currentUser: User | null = null;
  @Output() closeSidebar = new EventEmitter<void>();
  
  currentUser$: Observable<User | null>;
  
  constructor(
    private store: Store,
    private router: Router,
    private logger: LoggerService,
    private authService: AuthService
  ) {
    this.currentUser$ = this.authService.currentUser$;
  }
  
  ngOnInit(): void {
    // Additional initialization logic if needed
  }
  
  ngOnDestroy(): void {
    // Cleanup logic if needed
  }
  
  close(): void {
    this.closeSidebar.emit();
  }
  
  navigateToProfile(): void {
    this.router.navigate(['/app/profile']);
    this.close();
  }
  
  navigateToSettings(): void {
    this.router.navigate(['/app/settings']);
    this.close();
  }
  
  navigateToChangePassword(): void {
    this.router.navigate(['/app/profile/change-password']);
    this.close();
  }
  
  logout(): void {
    this.store.dispatch(new AuthActions.Logout()).subscribe({
      next: () => {
        this.router.navigate(['/login']);
      },
      error: (error) => {
        this.logger.error('Error during logout:', error);
        this.router.navigate(['/login']);
      }
    });
  }
  
  getDisplayName(user: User | null): string {
    if (!user) return '';
    if (user.firstName || user.lastName) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }
    return user.email;
  }
}
