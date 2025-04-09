import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

/**
 * Component shown when a user tries to access a resource they don't have permission for.
 */
@Component({
  selector: 'app-access-denied',
  template: `
    <div class="access-denied-container">
      <div class="access-denied-card">
        <h1>Access Denied</h1>
        <div class="icon-container">
          <i class="material-icons">lock</i>
        </div>
        <p>You don't have permission to access this resource.</p>
        <div class="button-container">
          <button class="back-button" (click)="goBack()">Go Back</button>
          <button class="home-button" (click)="goHome()">Go to Dashboard</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .access-denied-container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background-color: #f5f5f5;
    }
    
    .access-denied-card {
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      padding: 2rem;
      text-align: center;
      max-width: 400px;
      width: 100%;
    }
    
    h1 {
      color: #d32f2f;
      margin-bottom: 1.5rem;
    }
    
    .icon-container {
      margin: 1.5rem 0;
    }
    
    .material-icons {
      font-size: 4rem;
      color: #d32f2f;
    }
    
    p {
      margin-bottom: 1.5rem;
      color: #555;
      font-size: 1.1rem;
    }
    
    .button-container {
      display: flex;
      justify-content: center;
      gap: 1rem;
    }
    
    button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }
    
    .back-button {
      background-color: #f5f5f5;
      color: #555;
    }
    
    .home-button {
      background-color: #2196f3;
      color: white;
    }
  `]
})
export class AccessDeniedComponent {
  constructor(
    private location: Location,
    private router: Router
  ) {}

  /**
   * Navigate back to the previous page
   */
  goBack(): void {
    this.location.back();
  }

  /**
   * Navigate to the dashboard
   */
  goHome(): void {
    this.router.navigate(['/dashboard']);
  }
} 