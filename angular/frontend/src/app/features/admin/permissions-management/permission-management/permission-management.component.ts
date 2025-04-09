import { Component } from '@angular/core';

@Component({
  selector: 'app-permission-management',
  template: `
    <div class="permission-management-container">
      <mat-card class="nav-card">
        <mat-card-header>
          <mat-card-title>Permission Management</mat-card-title>
          <mat-card-subtitle>
            Manage permissions for components, routes, and API endpoints
          </mat-card-subtitle>
        </mat-card-header>
        
        <mat-card-content>
          <nav mat-tab-nav-bar>
            <a 
              mat-tab-link
              routerLink="list"
              routerLinkActive #rla1="routerLinkActive" 
              [active]="rla1.isActive"
            >
              Permissions
            </a>
            <a 
              mat-tab-link
              routerLink="components"
              routerLinkActive #rla2="routerLinkActive" 
              [active]="rla2.isActive"
            >
              UI Components
            </a>
            <a 
              mat-tab-link
              routerLink="routes"
              routerLinkActive #rla3="routerLinkActive" 
              [active]="rla3.isActive"
            >
              Routes
            </a>
            <a 
              mat-tab-link
              routerLink="endpoints"
              routerLinkActive #rla4="routerLinkActive" 
              [active]="rla4.isActive"
            >
              API Endpoints
            </a>
            <a 
              mat-tab-link
              routerLink="sync"
              routerLinkActive #rla5="routerLinkActive" 
              [active]="rla5.isActive"
            >
              Sync Status
            </a>
          </nav>
        </mat-card-content>
      </mat-card>

      <div class="content-container">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .permission-management-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .nav-card {
      margin-bottom: 20px;
    }
    
    .content-container {
      background-color: white;
      padding: 20px;
      border-radius: 4px;
      box-shadow: 0 2px 1px -1px rgba(0,0,0,.2),
                  0 1px 1px 0 rgba(0,0,0,.14),
                  0 1px 3px 0 rgba(0,0,0,.12);
    }
  `]
})
export class PermissionManagementComponent {} 