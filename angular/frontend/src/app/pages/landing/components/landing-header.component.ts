import { Component } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
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
      <div class="logo-container" routerLink="/" (click)="logoClick($event)">
        <span class="app-title">Angular Frontend Template</span>
      </div>
      <span class="spacer"></span>
      <div class="auth-buttons">
        <a mat-button (click)="loginClick($event)">
          <mat-icon>login</mat-icon>
          <span>Login</span>
        </a>
        <a mat-raised-button color="accent" (click)="registerClick($event)">
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
export class LandingHeaderComponent {
  constructor(private router: Router) {}
  
  logoClick(event: MouseEvent): void {
    console.log('Logo clicked');
    // Prevent the default action to ensure our navigation works
    event.preventDefault();
    // Use window.location for a full page navigation if needed
    window.location.href = '/';
  }
  
  loginClick(event: MouseEvent): void {
    console.log('Login button clicked');
    // Prevent the default action
    event.preventDefault();
    // Try multiple navigation methods to ensure it works
    try {
      console.log('Navigating to login using multiple methods');
      this.router.navigate(['/login']).then(success => {
        console.log('Router navigation result:', success);
        if (!success) {
          console.log('Router navigation failed, trying direct navigation');
          window.location.href = '/login';
        }
      }).catch(error => {
        console.error('Router navigation error:', error);
        window.location.href = '/login';
      });
    } catch (e) {
      console.error('Navigation error, using fallback:', e);
      window.location.href = '/login';
    }
  }
  
  registerClick(event: MouseEvent): void {
    console.log('Register button clicked');
    // Prevent the default action
    event.preventDefault();
    // Try multiple navigation methods to ensure it works
    try {
      console.log('Navigating to register using multiple methods');
      this.router.navigate(['/register']).then(success => {
        console.log('Router navigation result:', success);
        if (!success) {
          console.log('Router navigation failed, trying direct navigation');
          window.location.href = '/register';
        }
      }).catch(error => {
        console.error('Router navigation error:', error);
        window.location.href = '/register';
      });
    } catch (e) {
      console.error('Navigation error, using fallback:', e);
      window.location.href = '/register';
    }
  }
} 