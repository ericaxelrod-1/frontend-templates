import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterModule } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
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
    HeaderComponent,
    SidebarComponent,
    FooterComponent
  ],
  template: `
    <!-- APPROACH 1: Header Outside Sidenav Container -->
    <!-- This eliminates all z-index conflicts and positioning issues -->
    <app-header 
      [sidebarOpened]="layoutConfig.sidebarOpened"
      (sidebarToggle)="toggleSidebar()">
    </app-header>
    
    <!-- Sidenav container positioned below fixed header -->
    <mat-sidenav-container 
      class="layout-container"
      [autosize]="false"
      [hasBackdrop]="false">
      
      <mat-sidenav 
        #drawer
        mode="side"
        [opened]="layoutConfig.sidebarOpened"
        [disableClose]="true"
        class="layout-sidenav">
        <app-sidebar></app-sidebar>
      </mat-sidenav>

      <mat-sidenav-content class="layout-content">
        <main class="main-content">
          <router-outlet></router-outlet>
        </main>
        
        <app-footer></app-footer>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styleUrls: ['./default.component.scss']
})
export class DefaultLayoutComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  layoutConfig: LayoutConfig = {
    sidebarWidth: 280,
    sidebarMode: 'side',
    sidebarOpened: true,
    responsiveState: 'fixed',
    isMobile: false
  };

  constructor(private layoutService: LayoutService) {}

  ngOnInit(): void {
    // Set fixed sidebar configuration
    this.layoutService.setFixedSidebarConfiguration();
    
    // Subscribe to layout config changes (for manual toggle only)
    this.layoutService.config$
      .pipe(takeUntil(this.destroy$))
      .subscribe((config: LayoutConfig) => {
        this.layoutConfig = config;
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