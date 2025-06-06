import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterModule } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { FooterComponent } from '../footer/footer.component';
import { Subject, takeUntil } from 'rxjs';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';

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
    MatSidenavModule
  ],
  template: `
    <!-- CSS Grid Layout Container -->
    <div class="app-layout">
      <!-- Header: Fixed at top, full viewport width -->
      <app-header 
        class="layout-header"
        [sidebarOpened]="!isCollapsed"
        (sidebarToggle)="toggleMenu()">
      </app-header>
      
      <!-- Main Area: Contains sidebar and content -->
      <div class="layout-main">
        <!-- Material Sidenav Container with proper height constraints -->
        <mat-sidenav-container class="sidenav-container">
          <!-- Material Sidenav with proper responsive behavior -->
          <mat-sidenav 
            #sidenav
            [mode]="isMobile ? 'over' : 'side'" 
            [opened]="isMobile ? false : true"
            [ngClass]="!isCollapsed ? 'expanded' : ''"
            class="sidenav">
            <app-sidebar [isCollapsed]="isCollapsed"></app-sidebar>
          </mat-sidenav>
          
          <!-- Sidenav Content - Main content area -->
          <mat-sidenav-content class="sidenav-content">
            <main class="main-content">
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

  constructor(private breakpointObserver: BreakpointObserver) {}

  ngOnInit(): void {
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
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    try {
      const saved = localStorage.getItem('sidebarCollapsed');
      if (saved !== null) {
        this.isCollapsed = JSON.parse(saved);
      }
    } catch (error) {
      // If localStorage fails, use default state (expanded)
      console.warn('Failed to load sidebar state from localStorage:', error);
      this.isCollapsed = false;
    }
  }

  /**
   * Save sidebar state to localStorage
   * Ensures user preference is remembered
   */
  private saveSidebarState(): void {
    try {
      localStorage.setItem('sidebarCollapsed', JSON.stringify(this.isCollapsed));
    } catch (error) {
      // If localStorage fails, continue without persistence
      console.warn('Failed to save sidebar state to localStorage:', error);
    }
  }
} 