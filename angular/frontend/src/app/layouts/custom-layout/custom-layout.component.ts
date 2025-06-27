import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterModule, Router, NavigationEnd } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { FooterComponent } from '../footer/footer.component';
import { UserSidebarComponent } from '../user-sidebar/user-sidebar.component';
import { Subject, takeUntil, Observable } from 'rxjs';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../models';
import { filter } from 'rxjs/operators';

/**
 * Custom Layout Component - CSS Grid Layout Implementation
 * 
 * Following modern web app layout patterns with CSS Grid:
 * - Header: Fixed at top, full viewport width
 * - Sidebar: Responsive behavior (over/side mode)
 * - Main Content: Flexible content area with proper scrolling
 * - Footer: Fixed at bottom, full viewport width
 * 
 * Key Features:
 * - CSS Grid for automatic height management
 * - No manual height calculations needed
 * - Proper navigation menu scrolling
 * - Responsive breakpoint detection
 * - Modern layout architecture
 * - Admin context detection for nested navigation
 */
@Component({
  selector: 'app-custom-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    HeaderComponent,
    SidebarComponent,
    FooterComponent,
    UserSidebarComponent,
    MatSidenavModule,
    MatIconModule
  ],
  template: `
    <!-- CSS Grid Layout Container -->
    <div class="app-layout" [class.admin-context]="isAdminContext">
      <!-- Header: Fixed at top, full viewport width -->
      <app-header
        class="layout-header"
        [sidebarOpened]="!isCollapsed"
        [isAdminContext]="isAdminContext"
        (sidebarToggle)="toggleMenu()"
        (userMenuToggle)="openUserSidebar()">
      </app-header>

      <!-- Main Area: Contains sidebar and content -->
      <div class="layout-main">
        <!-- Material Sidenav Container with proper height constraints -->
        <mat-sidenav-container class="sidenav-container">
          <!-- Single Dynamic Sidenav with context-based content -->
          <mat-sidenav
            #sidenav
            [mode]="isMobile ? 'over' : 'side'"
            [opened]="isMobile ? false : true"
            [ngClass]="!isCollapsed ? 'expanded' : ''"
            class="sidenav"
            position="start">
            
            <!-- Dynamic content based on context -->
            <ng-container *ngIf="!isAdminContext">
              <!-- Main navigation content -->
              <app-sidebar 
                [isCollapsed]="isCollapsed"
                [isAdminContext]="isAdminContext">
              </app-sidebar>
            </ng-container>
            
            <ng-container *ngIf="isAdminContext">
              <!-- Admin navigation content -->
              <div class="admin-sidebar-content">
                <div class="admin-sidebar-header">
                  <h3>Admin Panel</h3>
                </div>
                <nav class="admin-nav">
                  <!-- Back to Dashboard Link -->
                  <a routerLink="/app/dashboard" 
                     class="admin-nav-item back-to-dashboard">
                    <mat-icon>arrow_back</mat-icon>
                    <span>Back to Dashboard</span>
                  </a>
                  
                  <!-- Admin Menu Items -->
                  <a routerLink="/app/admin/login-monitoring" 
                     routerLinkActive="active"
                     class="admin-nav-item">
                    <mat-icon>security</mat-icon>
                    <span>Login Monitoring</span>
                  </a>
                  <!-- Future admin navigation items can be added here -->
                </nav>
              </div>
            </ng-container>
          </mat-sidenav>

          <!-- Sidenav Content - Main content area -->
          <mat-sidenav-content class="sidenav-content">
            <main class="main-content">
              <!-- Admin breadcrumb when in admin context -->
              <div *ngIf="isAdminContext" class="admin-breadcrumb">
                <mat-icon>admin_panel_settings</mat-icon>
                <span>Administration</span>
                <mat-icon>chevron_right</mat-icon>
                <span>{{ getAdminPageTitle() }}</span>
              </div>
              
              <!-- Content wrapper for proper centering -->
              <div class="content-wrapper">
                <router-outlet></router-outlet>
              </div>
            </main>
          </mat-sidenav-content>
        </mat-sidenav-container>
      </div>
      
      <!-- Footer: Fixed at bottom, full viewport width -->
      <app-footer class="layout-footer"></app-footer>
    </div>
    
    <!-- User Sidebar: Right-side collapsible menu -->
    <app-user-sidebar 
      [isOpen]="isUserSidebarOpen"
      [currentUser]="currentUser$ | async"
      (closeSidebar)="closeUserSidebar()">
    </app-user-sidebar>
  `,
  styleUrls: ['./custom-layout.component.scss']
})
export class CustomLayoutComponent implements OnInit, OnDestroy {
  @ViewChild('sidenav') sidenav!: MatSidenav;
  
  private destroy$ = new Subject<void>();
  
  /**
   * Responsive state management
   */
  isMobile = false;
  isCollapsed = false;
  
  /**
   * Admin context detection
   */
  isAdminContext = false;
  
  /**
   * User sidebar state management
   */
  isUserSidebarOpen = false;
  currentUser$: Observable<User | null>;

  constructor(
    private breakpointObserver: BreakpointObserver,
    private authService: AuthService,
    private router: Router
  ) {
    this.currentUser$ = this.authService.currentUser$;
  }

  ngOnInit(): void {
    // Monitor route changes for admin context detection
    // Use setTimeout to defer state change to next tick to prevent NG0100 error
    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((event) => {
        const navEnd = event as NavigationEnd;
        // Defer admin context detection to next tick to prevent change detection violations
        setTimeout(() => {
          this.isAdminContext = navEnd.url.includes('/app/admin');
        }, 0);
      });
    
    // Monitor mobile breakpoint
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntil(this.destroy$))
      .subscribe(result => {
        this.isMobile = result.matches;
        if (this.isMobile) {
          this.isCollapsed = false; // On mobile, the menu can never be collapsed
        }
      });
      
    // Load sidebar state from localStorage for persistence
    this.loadSidebarState();
    
    // Subscribe to currentUser$ Observable
    this.currentUser$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => {
      // Handle user changes here
      if (user) {
        // User is logged in
        this.handleLoggedInUser(user);
      } else {
        // User is logged out
        this.handleLoggedOutUser();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Get admin page title based on current route
   */
  getAdminPageTitle(): string {
    const url = this.router.url;
    if (url.includes('login-monitoring')) {
      return 'Login Monitoring';
    }
    return 'Admin Panel';
  }

  /**
   * Toggle menu following the guide's approach:
   * - Mobile: Toggle sidenav open/close
   * - Desktop: Toggle collapsed state (never fully close)
   */
  toggleMenu(): void {
    if (this.isMobile) {
      this.sidenav.toggle();
      this.isCollapsed = false; // On mobile, the menu can never be collapsed
    } else {
      this.sidenav.open(); // On desktop/tablet, the menu can never be fully closed
      this.isCollapsed = !this.isCollapsed;
    }
    this.saveSidebarState();
  }

  /**
   * Load sidebar state from localStorage
   * Provides persistence across browser sessions
   */
  private loadSidebarState(): void {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('sidebarCollapsed');
      if (saved !== null) {
        this.isCollapsed = JSON.parse(saved);
      }
    }
  }

  /**
   * Save sidebar state to localStorage
   * Ensures user preference is remembered
   */
  private saveSidebarState(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sidebarCollapsed', JSON.stringify(this.isCollapsed));
    }
  }
  
  /**
   * Open user sidebar
   * Called from header component when user button is clicked
   */
  openUserSidebar(): void {
    this.isUserSidebarOpen = true;
  }
  
  /**
   * Close user sidebar
   * Called from user sidebar component when close is triggered
   */
  closeUserSidebar(): void {
    this.isUserSidebarOpen = false;
  }

  private handleLoggedInUser(user: User): void {
    // Add your logged in user logic here
  }
  
  private handleLoggedOutUser(): void {
    // Add your logged out user logic here
  }
} 