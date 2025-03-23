import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DebugButtonComponent } from './components/debug/debug-button.component';
import { DebugLogsComponent } from './components/debug/debug-logs.component';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, DebugButtonComponent, DebugLogsComponent],
  template: `
    <router-outlet></router-outlet>
    <app-debug-button *ngIf="showDebugTools"></app-debug-button>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
  `]
})
export class AppComponent {
  title = 'frontend';
  showDebugTools = !environment.production && environment.logging?.enabled;
}
