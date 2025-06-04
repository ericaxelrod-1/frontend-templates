import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterModule } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    MatSidenavModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatDividerModule,
    MatTooltipModule,
    HeaderComponent,
    SidebarComponent,
    FooterComponent
  ],
  template: `
    <div class="admin-container">
      <!-- Admin header with custom styling -->
      <mat-toolbar color="primary" class="admin-header">
        <button mat-icon-button (click)="toggleSidebar()">
          <mat-icon>menu</mat-icon>
        </button>
        <span>Admin Dashboard</span>
        <span class="spacer"></span>
        <button mat-icon-button [routerLink]="['/app/dashboard']" matTooltip="Return to App">
          <mat-icon>exit_to_app</mat-icon>
        </button>
      </mat-toolbar>
      
      <mat-sidenav-container class="admin-sidenav-container">
        <mat-sidenav [opened]="sidebarOpened" 
                     mode="side" 
                     class="admin-sidebar">
          <div class="admin-sidebar-header">
            <h3>Admin Panel</h3>
          </div>
          <mat-nav-list>
            <a mat-list-item [routerLink]="['/admin/login-monitoring']" routerLinkActive="active">
              <mat-icon>security</mat-icon>
              <span>Login Monitoring</span>
            </a>
            <a mat-list-item [routerLink]="['/admin/permissions']" routerLinkActive="active">
              <mat-icon>admin_panel_settings</mat-icon>
              <span>Permissions Management</span>
            </a>
            <mat-divider></mat-divider>
            <a mat-list-item [routerLink]="['/app/dashboard']">
              <mat-icon>home</mat-icon>
              <span>Back to App</span>
            </a>
          </mat-nav-list>
        </mat-sidenav>
        
        <mat-sidenav-content class="admin-content">
          <div class="admin-content-wrapper">
            <router-outlet></router-outlet>
          </div>
          <app-footer></app-footer>
        </mat-sidenav-content>
      </mat-sidenav-container>
    </div>
  `,
  styles: [`
    .admin-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background-color: #303030;
      color: white;
    }
    
    .admin-header {
      height: 64px;
      background-color: #673ab7;
      color: white;
      box-shadow: 0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px 0 rgba(0,0,0,.14), 0 1px 18px 0 rgba(0,0,0,.12);
      z-index: 2;
    }
    
    .spacer {
      flex: 1 1 auto;
    }
    
    .admin-sidenav-container {
      flex: 1;
      width: 100%;
    }
    
    .admin-sidebar {
      width: 250px;
      background-color: #424242;
      color: white;
      border-right: 1px solid #616161;
    }
    
    .admin-sidebar-header {
      padding: 16px;
      background-color: #512da8;
      color: white;
      text-align: center;
      border-bottom: 1px solid #616161;
    }
    
    .admin-content {
      background-color: #303030;
      padding: 0;
      overflow: auto;
    }
    
    .admin-content-wrapper {
      padding: 20px;
      min-height: calc(100vh - 64px - 50px);
    }
    
    mat-nav-list a.active {
      background-color: rgba(103, 58, 183, 0.2);
      border-left: 4px solid #673ab7;
    }
    
    mat-nav-list a mat-icon {
      margin-right: 16px;
    }
  `]
})
export class AdminLayoutComponent {
  sidebarOpened = true;

  constructor() {}

  toggleSidebar(): void {
    this.sidebarOpened = !this.sidebarOpened;
  }
} 