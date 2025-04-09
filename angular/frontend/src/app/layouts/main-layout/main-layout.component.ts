import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd, Event } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { FooterComponent } from '../footer/footer.component';
import { filter } from 'rxjs/operators';
import { Store } from '@ngxs/store';
import { AuthState, AuthActions } from '../../store/auth/auth.state';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';
import { LoggerService } from '../../services/logging/logger.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    MatSidenavModule,
    MatButtonModule,
    MatIconModule,
    HeaderComponent,
    SidebarComponent,
    FooterComponent
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss'
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  sidebarOpened = true;
  isAuthPage = false;
  private subscription = new Subscription();

  constructor(
    private router: Router,
    private store: Store,
    private authService: AuthService,
    private logger: LoggerService
  ) {}

  ngOnInit() {
    // Refresh the auth state from storage first
    this.authService.refreshAuthStateFromStorage();
    
    // Check initial route
    this.checkIfAuthPage(this.router.url);

    // Subscribe to route changes
    this.subscription.add(
      this.router.events.pipe(
        filter((event: Event): event is NavigationEnd => event instanceof NavigationEnd)
      ).subscribe((event: NavigationEnd) => {
        this.checkIfAuthPage(event.url);
        
        // Check auth state on navigation to prevent stale state
        if (!this.isAuthPage) {
          this.checkAuthState();
        }
      })
    );

    // Check authentication state on component load
    this.checkAuthState();

    // Subscribe to auth service's user observable to get user preferences
    this.subscription.add(
      this.authService.currentUser$.subscribe(user => {
        if (user?.preferences?.sidebarCollapsed) {
          this.sidebarOpened = !user.preferences.sidebarCollapsed;
        }
      })
    );
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  toggleSidebar() {
    this.sidebarOpened = !this.sidebarOpened;
  }

  private checkIfAuthPage(url: string): void {
    // Check if current route is an auth page
    this.isAuthPage = url.includes('/login') || 
                      url.includes('/register') || 
                      url.includes('/forgot-password') || 
                      url.includes('/reset-password') ||
                      url.includes('/verify-email');
  }

  private checkAuthState(): void {
    this.logger.debug('Checking authentication state');
    
    // Force refresh from localStorage
    this.authService.refreshAuthStateFromStorage();
    
    // First check direct auth service state for faster response
    const directIsAuthenticated = this.authService.isAuthenticated;
    const directUser = this.authService.currentUser;
    const storeIsAuthenticated = this.store.selectSnapshot(AuthState.isAuthenticated);
    
    this.logger.info(`Auth service reports user is ${directIsAuthenticated ? '' : 'not '}authenticated`);
    this.logger.info(`Store reports user is ${storeIsAuthenticated ? '' : 'not '}authenticated`);
    
    // Check for state inconsistency between service and store
    if (directIsAuthenticated !== storeIsAuthenticated) {
      this.logger.warn('Authentication state inconsistency detected between service and store');
      
      if (directIsAuthenticated && directUser) {
        this.logger.info('Synchronizing store with service (service shows authenticated)');
        try {
          // Try to sync store state and disable hydration for this effect
          this.store.dispatch(new AuthActions.SetInitialAuthState(directUser, true)).subscribe({
            next: () => this.logger.info('Store synchronized with service state'),
            error: (err) => this.logger.error('Error synchronizing store with service state:', err)
          });
          
          // Make a second attempt with small delay to ensure it applies after hydration
          setTimeout(() => {
            if (!this.store.selectSnapshot(AuthState.isAuthenticated)) {
              this.logger.warn('Making second attempt to set authenticated state after hydration');
              this.store.dispatch(new AuthActions.SetInitialAuthState(directUser, true));
            }
          }, 50);
        } catch (error) {
          this.logger.error('Error during store synchronization:', error);
        }
      } else if (storeIsAuthenticated) {
        this.logger.info('Service shows not authenticated but store does - triggering profile refresh');
        // This will either update the user or clear the state if token is invalid
        this.store.dispatch(new AuthActions.GetProfile()).subscribe({
          next: () => this.logger.info('Profile refreshed successfully'),
          error: (err) => this.logger.error('Error refreshing profile:', err)
        });
      }
    } else if (directIsAuthenticated) {
      this.logger.info('User is authenticated, refreshing profile');
      this.store.dispatch(new AuthActions.GetProfile()).subscribe({
        next: () => this.logger.info('Profile refreshed successfully'),
        error: (err) => this.logger.error('Error refreshing profile:', err)
      });
    }
  }
}
