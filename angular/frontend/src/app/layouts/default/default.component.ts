import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterModule } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { FooterComponent } from '../footer/footer.component';

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
    <div class="app-container">
      <app-header (sidebarToggle)="toggleSidebar()"></app-header>
      
      <mat-sidenav-container class="sidenav-container">
        <mat-sidenav [opened]="sidebarOpened" 
                     mode="side" 
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
      width: 250px;
      background-color: #f8f9fa;
      border-right: 1px solid #dee2e6;
    }
    
    .main-content {
      background-color: #f8f9fa;
      padding: 0;
      overflow: auto;
    }
    
    .content-wrapper {
      padding: 20px;
      min-height: calc(100vh - 64px - 50px); /* Viewport height - header - footer */
    }
  `]
})
export class DefaultLayoutComponent implements OnInit {
  sidebarOpened = true;

  constructor() {}

  ngOnInit(): void {}

  toggleSidebar(): void {
    this.sidebarOpened = !this.sidebarOpened;
  }
} 