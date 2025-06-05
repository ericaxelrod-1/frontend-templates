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
 * Custom Layout Component - Proper Responsive Sidebar Implementation
 * 
 * Following the dev.to guide for responsive sidebar behavior:
 * - Mobile: over mode with toggle (open/close)
 * - Desktop: side mode with collapse (expanded/collapsed to icons only)
 * 
 * Key Features:
 * - Mobile: Sidebar toggles completely open/closed
 * - Desktop: Sidebar never fully closes, only collapses to icons
 * - Responsive breakpoint detection
 * - Proper Angular Material integration
 * - Smooth animations and transitions
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
    <!-- Fixed Header (outside of sidebar system) -->
    <app-header 
      [sidebarOpened]="!isCollapsed"
      (sidebarToggle)="toggleMenu()">
    </app-header>
    
    <!-- Material Sidenav Container -->
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
      
      <!-- Sidenav Content -->
      <mat-sidenav-content class="sidenav-content">
        <main class="main-content">
          <router-outlet></router-outlet>
        </main>
        
        <app-footer></app-footer>
      </mat-sidenav-content>
    </mat-sidenav-container>
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