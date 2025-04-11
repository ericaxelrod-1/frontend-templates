import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoggerService } from '../../services/logging/logger.service';
import { environment } from '../../../environments/environment';
import { DebugLogsComponent } from './debug-logs.component';

@Component({
  selector: 'app-debug-button',
  standalone: true,
  imports: [CommonModule, DebugLogsComponent],
  template: `
    <div class="debug-button">
      <button (click)="toggleLogs()" title="View logs">
        Logs: {{ logsCount }}
      </button>
    </div>
    <app-debug-logs 
      *ngIf="showLogs" 
      (closed)="showLogs = false"
      (logsCountChanged)="logsCount = $event">
    </app-debug-logs>
  `,
  styles: [`
    .debug-button {
      position: fixed;
      bottom: 10px;
      right: 10px;
      z-index: 9998;
    }
    
    button {
      background-color: #333;
      color: #fff;
      border: 1px solid #555;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    
    button:hover {
      background-color: #444;
    }
  `]
})
export class DebugButtonComponent implements OnInit {
  private logger = inject(LoggerService);
  
  isEnabled = !environment.production && environment.logging?.enabled;
  logsCount = 0;
  showLogs = false;
  
  ngOnInit(): void {
    if (this.isEnabled) {
      this.refreshLogCount();
    }
  }
  
  toggleLogs(): void {
    this.showLogs = !this.showLogs;
    if (this.showLogs) {
      this.refreshLogCount();
    }
  }
  
  refreshLogCount(): void {
    try {
      const logsJson = this.logger.exportLogs();
      const logs = JSON.parse(logsJson);
      this.logsCount = logs.length;
    } catch (e) {
      console.error('Failed to refresh log count', e);
    }
  }
  
  downloadLogs(): void {
    try {
      const logsJson = this.logger.exportLogs();
      const blob = new Blob([logsJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date();
      const timestamp = date.toISOString().replace(/[:.]/g, '-');
      a.download = `app-logs-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to download logs', e);
    }
  }
} 