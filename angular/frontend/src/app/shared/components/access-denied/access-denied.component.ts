import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

/**
 * Component shown when a user tries to access a resource they don't have permission for.
 */
@Component({
  selector: 'app-access-denied',
  template: `
    <div class="access-denied-container" role="main" aria-labelledby="access-denied-title">
      <div class="access-denied-card">
        <h1 id="access-denied-title">Access Denied</h1>
        <div class="icon-container" aria-hidden="true">
          <i class="material-icons">lock</i>
        </div>
        <p>You don't have permission to access this resource.</p>
        <div class="button-container">
          <button class="back-button" (click)="goBack()" aria-label="Go back to previous page">
            Go Back
          </button>
          <button class="home-button" (click)="goHome()" aria-label="Go to dashboard">
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .access-denied-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background-color: var(--background-dark);
      padding: 1rem;
    }
    
    .access-denied-card {
      background-color: var(--background-card);
      border-radius: 8px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      padding: 2rem;
      text-align: center;
      max-width: 400px;
      width: 100%;
      color: var(--text-primary);
    }
    
    h1 {
      color: var(--error);
      margin-bottom: 1.5rem;
      font-size: 1.5rem;
      font-weight: 500;
    }
    
    .icon-container {
      margin: 1.5rem 0;
    }
    
    .material-icons {
      font-size: 4rem;
      color: var(--error);
    }
    
    p {
      margin-bottom: 1.5rem;
      color: var(--text-secondary);
      font-size: 1.1rem;
      line-height: 1.4;
    }
    
    .button-container {
      display: flex;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    
    button {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.875rem;
      transition: background-color 0.2s ease, transform 0.1s ease;
      min-width: 120px;
    }
    
    button:hover {
      transform: translateY(-1px);
    }
    
    button:focus {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    
    .back-button {
      background-color: var(--surface);
      color: var(--text-primary);
      border: 1px solid var(--text-secondary);
    }
    
    .back-button:hover {
      background-color: var(--background-dark);
    }
    
    .home-button {
      background-color: var(--primary-color);
      color: var(--text-on-primary);
    }
    
    .home-button:hover {
      background-color: var(--primary-dark);
    }
    
    /* Responsive design */
    @media (max-width: 480px) {
      .access-denied-container {
        padding: 0.5rem;
      }
      
      .access-denied-card {
        padding: 1.5rem;
      }
      
      .button-container {
        flex-direction: column;
        align-items: center;
      }
      
      button {
        width: 100%;
        max-width: 200px;
      }
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