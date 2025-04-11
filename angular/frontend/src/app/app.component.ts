import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DebugButtonComponent } from './components/debug/debug-button.component';
import { DebugLogsComponent } from './components/debug/debug-logs.component';
import { environment } from '../environments/environment';
import { CookieConsentComponent } from '../shared/cookie-consent/cookie-consent.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    CommonModule,
    DebugButtonComponent,
    DebugLogsComponent,
    CookieConsentComponent
  ],
  template: `
    <div class="app-container">
      <router-outlet></router-outlet>
      
      <app-debug-button *ngIf="showDebugTools"></app-debug-button>
      <app-debug-logs *ngIf="showDebugTools && showLogs" 
                    (closed)="showLogs = false"
                    (logsCountChanged)="updateLogsCount($event)">
      </app-debug-logs>
      <app-cookie-consent></app-cookie-consent>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    
    .app-container {
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }
  `]
})
export class AppComponent {
  title = 'frontend';
  showDebugTools = !environment.production && environment.logging?.enabled;
  showLogs = false;
  logsCount = 0;

  updateLogsCount(count: number): void {
    this.logsCount = count;
  }
}
