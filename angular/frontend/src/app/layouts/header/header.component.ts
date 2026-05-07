import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription, map } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AppConfigService } from '../../core/services/app-config.service';
import { PageTitleService } from '../../core/services/page-title.service';
import { User } from '../../models/user.model';
import { AuthActions } from '../../store/auth/auth.state';
import { PrivacyState } from '../../store/privacy/privacy.state';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';
import { LoggerService } from '../../services/logging/logger.service';

/**
 * Header Component - Simplified for Custom Layout System
 * 
 * Updated to work with the new custom layout system that doesn't require
 * complex responsive state management. The header now simply receives
 * sidebar state as input and emits toggle events.
 * 
 * Features:
 * - Admin context awareness for consistent theming
 * - User menu integration
 * - Responsive sidebar toggle
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    MatBadgeModule
  ],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() isFixedHeader = false;
  @Input() sidebarOpened = true;
  @Input() isAdminContext = false;
  @Output() sidebarToggle = new EventEmitter<void>();
  @Output() userMenuToggle = new EventEmitter<void>();

  @Select(PrivacyState.getActiveTicketsCount) pendingTicketsCount$!: Observable<number>;
  isAuthenticated$: Observable<boolean>;
  currentUser$: Observable<User | null>;
  pageTitle$: Observable<string>;

  isAuthenticated = false;
  user: User | null = null;
  private subscription = new Subscription();

  appName: string;
  headerLogo: string;

  constructor(
    private authService: AuthService,
    private store: Store,
    private appConfig: AppConfigService,
    private pageTitleService: PageTitleService,
    private router: Router,
    private logger: LoggerService,
    private cdr: ChangeDetectorRef
  ) {
    this.appName = this.appConfig.appName;
    this.headerLogo = this.appConfig.headerLogo;

    this.pageTitle$ = this.pageTitleService.title$;
    this.currentUser$ = this.authService.currentUser$;
    this.isAuthenticated$ = this.authService.currentUser$.pipe(
      map(user => !!user)
    );
    this.pendingTicketsCount$ = this.store.select(PrivacyState.getActiveTicketsCount);
  }

  ngOnInit(): void {
    this.subscription.add(
      this.authService.currentUser$.subscribe(user => {
        this.user = user;
        this.isAuthenticated = !!user;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  toggleSidebar(): void {
    this.sidebarToggle.emit();
  }

  logout(): void {
    this.store.dispatch(new AuthActions.Logout()).subscribe({
      next: () => {
        this.router.navigate(['/login']);
      },
      error: (error) => {
        console.error('Error during logout:', error);
        this.router.navigate(['/login']);
      }
    });
  }

  navigateToProfile(): void {
    // Implement the logic to navigate to the user's profile
  }

  navigateToSettings(): void {
    // Implement the logic to navigate to the user's settings
  }

  onSidebarToggle(): void {
    this.sidebarToggle.emit();
  }

  onUserMenuToggle(): void {
    this.userMenuToggle.emit();
  }

  getDisplayName(user: User | null): string {
    if (!user) return '';
    if (user.firstName || user.lastName) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }
    return user.email;
  }
}
