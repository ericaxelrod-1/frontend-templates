import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-landing-header',
  standalone: true,
  imports: [CommonModule, RouterModule, MatToolbarModule, MatButtonModule, MatIconModule],
  template: `
    <mat-toolbar color="primary">
      <div class="logo-container" routerLink="/">
        <span class="app-title">Angular Frontend Template</span>
      </div>
      <span class="spacer"></span>
      <div class="auth-buttons">
        <a mat-button routerLink="/login">
          <mat-icon>login</mat-icon>
          <span>Login</span>
        </a>
        <a mat-raised-button color="accent" routerLink="/register">
          <mat-icon>person_add</mat-icon>
          <span>Create Account</span>
        </a>
      </div>
    </mat-toolbar>
  `,
  styles: [`
    .spacer {
      flex: 1 1 auto;
    }
    
    .logo-container {
      display: flex;
      align-items: center;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background-color 0.2s ease;
    }
    
    .logo-container:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
    
    .app-title {
      font-size: 1.2rem;
      font-weight: 500;
    }
    
    .auth-buttons {
      display: flex;
      gap: 8px;
    }
    
    mat-toolbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
    }
  `]
})
export class LandingHeaderComponent { } 