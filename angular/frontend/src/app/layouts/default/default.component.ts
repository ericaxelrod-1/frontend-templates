import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterModule } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { BreakpointObserver, Breakpoints, LayoutModule } from '@angular/cdk/layout';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { FooterComponent } from '../footer/footer.component';
import { LayoutService, LayoutConfig } from '../../core/services/layout.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-default-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    MatSidenavModule,
    LayoutModule,
    HeaderComponent,
    SidebarComponent,
    FooterComponent
  ],
  template: `
    <div class="app-container">
      <app-header (sidebarToggle)="toggleSidebar()"></app-header>
      
      <mat-sidenav-container class="sidenav-container" hasBackdrop="false">
        <mat-sidenav 
          [opened]="layoutConfig.sidebarOpened" 
          [mode]="layoutConfig.sidebarMode"
          position="start"
          [disableClose]="false"
          [fixedInViewport]="true"
          [fixedTopGap]="64"
          [fixedBottomGap]="0"
          class="sidebar">
          <app-sidebar></app-sidebar>
        </mat-sidenav>
        
        <mat-sidenav-content class="main-content">
          <div class="content-wrapper">
            <router-outlet></router-outlet>
          </div>
          <app-footer></app-footer>
        </mat-sidenav-content>
      </mat-sidenav-container>
    </div>
  `,
  styles: [`
    .app-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    
    .sidenav-container {
      flex: 1;
      width: 100%;
    }
    
    .sidebar {
      background-color: var(--mdc-theme-surface);
      border-right: 1px solid var(--mdc-theme-outline);
      overflow-x: hidden;
      overflow-y: auto;
    }
    
    .main-content {
      background-color: var(--mdc-theme-background);
      color: var(--mdc-theme-on-background);
      padding: 0;
      overflow: auto;
      flex: 1;
    }
    
    .content-wrapper {
      padding: 20px;
      min-height: calc(100vh - 64px - 50px);
      max-width: 100%;
      box-sizing: border-box;
    }
  `]
})
export class DefaultLayoutComponent implements OnInit, OnDestroy {
  layoutConfig: LayoutConfig;
  private destroy$ = new Subject<void>();

  constructor(
    private layoutService: LayoutService,
    private breakpointObserver: BreakpointObserver
  ) {
    this.layoutConfig = this.layoutService.currentConfig;
  }

  ngOnInit(): void {
    // Subscribe to layout config changes
    this.layoutService.config$
      .pipe(takeUntil(this.destroy$))
      .subscribe(config => {
        this.layoutConfig = config;
      });

    // Handle responsive breakpoints using Angular CDK
    this.breakpointObserver
      .observe([
        Breakpoints.HandsetPortrait,
        Breakpoints.HandsetLandscape,
        Breakpoints.TabletPortrait,
        '(max-width: 959px)'
      ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(result => {
        const isMobile = result.matches;
        this.layoutService.setMobileState(isMobile);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleSidebar(): void {
    this.layoutService.toggleSidebar();
  }
} 