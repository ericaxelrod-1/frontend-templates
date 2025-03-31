import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../store/auth/auth.state';
import { User } from '../../models';
import { AppConfigService } from '../../core/services';
import { AuthService } from '../../core/services/auth.service';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule
  ]
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() isFixedHeader = false;
  @Output() sidebarToggle = new EventEmitter<void>();
  
  @Select(AuthState.isAuthenticated) isAuthenticated$?: Observable<boolean>;
  @Select(AuthState.user) user$?: Observable<User | null>;
  
  isAuthenticated = false;
  user: User | null = null;
  private subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);
  private localAuthState: { isAuthenticated: boolean, hasUser: boolean } = { isAuthenticated: false, hasUser: false };
  private ignoreNextStoreUpdate = false;
  
  // App configuration properties
  appName: string;
  headerLogo: string;
  
  constructor(
    public authService: AuthService,
    private store: Store,
    private appConfig: AppConfigService,
    private router: Router
  ) {
    this.appName = this.appConfig.appName;
    this.headerLogo = this.appConfig.headerLogo;
  }
  
  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      // Get initial auth state directly from service (this should reflect localStorage state)
      this.localAuthState = {
        isAuthenticated: this.authService.isAuthenticated, 
        hasUser: !!this.authService.currentUser
      };
      
      // Set component state from direct service initially
      this.isAuthenticated = this.authService.isAuthenticated;
      this.user = this.authService.currentUser;
      
      console.log(`HeaderComponent initialized with auth state: ${JSON.stringify({
        isAuthenticated: this.isAuthenticated,
        hasUser: !!this.user,
        source: 'direct service'
      })}`);
      
      // Delay subscription to store observables to allow hydration to complete
      setTimeout(() => {
        // Check if store state matches local auth state after hydration
        this.checkAuthStateConsistency();
        
        // Subscribe to store observables with a small delay to help with SSR/hydration timing
        if (this.isAuthenticated$) {
          this.subscription.add(
            this.isAuthenticated$.subscribe(isAuthenticated => {
              console.log(`Auth state updated from store: ${JSON.stringify({
                isAuthenticated,
                hasUser: !!this.user,
                source: 'NGXS store'
              })}`);
              
              // If we need to ignore this update (because we're correcting the store)
              if (this.ignoreNextStoreUpdate) {
                console.log('Ignoring store update as we just corrected the state');
                this.ignoreNextStoreUpdate = false;
                return;
              }
              
              // During hydration, prefer localStorage state if it shows authenticated
              if (this.localAuthState.isAuthenticated && !isAuthenticated) {
                console.log('Store reports not authenticated but localStorage does - correcting store state');
                this.correctStoreState();
                return;
              }
              
              this.isAuthenticated = isAuthenticated;
            })
          );
        }
        
        if (this.user$) {
          this.subscription.add(
            this.user$.subscribe(user => {
              if (user) {
                this.user = user;
              } else if (this.localAuthState.hasUser && !user) {
                // If we have a user in localStorage but not in store, this might be a hydration issue
                console.log('User missing in store but present in localStorage - may need to correct store');
              }
            })
          );
        }
      }, 100); // Short delay to allow hydration
    }
  }
  
  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
  
  toggleSidebar(): void {
    this.sidebarToggle.emit();
  }
  
  logout(): void {
    console.log('HeaderComponent: Initiating logout sequence');
    
    // Dispatch the logout action and wait for it to complete
    this.store.dispatch(new AuthActions.Logout()).subscribe({
      next: () => {
        console.log('HeaderComponent: Logout action completed successfully, navigating to login page');
        this.router.navigate(['/login']);
      },
      error: (error) => {
        console.error('HeaderComponent: Error during logout:', error);
        // Still navigate to login even on error
        this.router.navigate(['/login']);
      }
    });
  }
  
  /**
   * Check if state from NGXS store matches our localStorage state after hydration
   * and correct it if needed
   */
  private checkAuthStateConsistency(): void {
    // Get current store state from selectors
    const storeIsAuthenticated = this.store.selectSnapshot(AuthState.isAuthenticated);
    const storeUser = this.store.selectSnapshot(AuthState.user);
    
    // Compare with direct service state
    if (this.localAuthState.isAuthenticated && !storeIsAuthenticated) {
      console.log('After hydration: Store state does not match localStorage state - correcting');
      this.correctStoreState();
    } else {
      console.log('After hydration: Store state matches localStorage state');
    }
  }
  
  /**
   * Correct the store state if it doesn't match the localStorage state
   * by forcing a refresh from the AuthService
   */
  private correctStoreState(): void {
    this.ignoreNextStoreUpdate = true;
    this.authService.refreshAuthStateFromStorage();
    
    // If we have a user in localStorage, set the initial state in the store
    if (this.authService.currentUser) {
      this.store.dispatch(new AuthActions.SetInitialAuthState(
        this.authService.currentUser,
        true
      ));
    }
  }
}
