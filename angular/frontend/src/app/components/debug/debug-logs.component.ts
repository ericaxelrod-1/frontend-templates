import { Component, OnInit, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoggerService, LogEntry, LogLevel } from '../../services/logging/logger.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-debug-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="debug-panel">
      <div class="debug-header">
        <h3>Debug Logs</h3>
        <div class="debug-actions">
          <button (click)="refreshLogs()">Refresh</button>
          <button (click)="clearLogs()">Clear</button>
          <button (click)="downloadLogs()">Download</button>
          <button (click)="close()">Close</button>
        </div>
      </div>
      <div class="filter-controls">
        <label>
          Filter Level:
          <select [(ngModel)]="filterLevel" (ngModelChange)="applyFilters()">
            <option value="all">All</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label>
          Search:
          <input type="text" [(ngModel)]="searchText" (ngModelChange)="applyFilters()" placeholder="Filter logs..." />
        </label>
      </div>
      <div class="logs-container">
        <div *ngFor="let log of filteredLogs" class="log-entry" [ngClass]="getLogLevelString(log.level)">
          <div class="log-timestamp">{{ log.timestamp | date:'medium' }}</div>
          <div class="log-level">{{ getLogLevelString(log.level).toUpperCase() }}</div>
          <div class="log-message">{{ log.message }}</div>
          <div class="log-data" *ngIf="log.data">
            <pre>{{ log.data | json }}</pre>
          </div>
        </div>
        <div *ngIf="filteredLogs.length === 0" class="no-logs">
          No logs to display
        </div>
      </div>
    </div>
  `,
  styles: [`
    .debug-panel {
      position: fixed;
      bottom: 0;
      right: 0;
      width: 80%;
      max-width: 800px;
      height: 50%;
      max-height: 500px;
      background-color: #1e1e1e;
      color: #fff;
      border: 1px solid #444;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
      border-top-left-radius: 5px;
      font-family: 'Courier New', monospace;
    }
    
    .debug-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background-color: #333;
      border-bottom: 1px solid #555;
    }
    
    .debug-header h3 {
      margin: 0;
      font-size: 16px;
    }
    
    .debug-actions {
      display: flex;
      gap: 8px;
    }
    
    .filter-controls {
      display: flex;
      padding: 8px 12px;
      gap: 12px;
      background-color: #2a2a2a;
      border-bottom: 1px solid #444;
    }
    
    .filter-controls label {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .filter-controls select,
    .filter-controls input {
      background-color: #333;
      color: #fff;
      border: 1px solid #555;
      padding: 4px 8px;
      border-radius: 3px;
    }
    
    .logs-container {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }
    
    .log-entry {
      padding: 6px 12px;
      border-bottom: 1px solid #333;
      font-size: 12px;
    }
    
    .log-entry.debug {
      background-color: #1e1e1e;
    }
    
    .log-entry.info {
      background-color: #1a3450;
    }
    
    .log-entry.warn {
      background-color: #4d3c00;
    }
    
    .log-entry.error {
      background-color: #4c1414;
    }
    
    .log-timestamp {
      font-size: 11px;
      color: #888;
    }
    
    .log-level {
      font-weight: bold;
      margin-right: 8px;
      display: inline-block;
    }
    
    .debug {
      color: #7fbfff;
    }
    
    .info {
      color: #7fffff;
    }
    
    .warn {
      color: #ffcf7f;
    }
    
    .error {
      color: #ff7f7f;
    }
    
    .log-message {
      word-break: break-all;
    }
    
    .log-data pre {
      margin: 4px 0 0 0;
      padding: 4px 8px;
      background-color: rgba(0, 0, 0, 0.2);
      border-radius: 3px;
      overflow-x: auto;
      font-size: 11px;
    }
    
    .no-logs {
      padding: 12px;
      text-align: center;
      color: #888;
    }
    
    button {
      background-color: #333;
      color: #fff;
      border: 1px solid #555;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
    }
    
    button:hover {
      background-color: #444;
    }
  `]
})
export class DebugLogsComponent implements OnInit {
  private logger = inject(LoggerService);
  
  @Output() closed = new EventEmitter<void>();
  @Output() logsCountChanged = new EventEmitter<number>();
  
  logs: LogEntry[] = [];
  filteredLogs: LogEntry[] = [];
  filterLevel = 'all';
  searchText = '';
  
  ngOnInit(): void {
    this.refreshLogs();
  }
  
  close(): void {
    this.closed.emit();
  }
  
  refreshLogs(): void {
    try {
      const logsJson = this.logger.exportLogs();
      this.logs = JSON.parse(logsJson);
      this.applyFilters();
      this.logsCountChanged.emit(this.logs.length);
    } catch (e) {
      console.error('Failed to parse logs', e);
      this.logs = [];
      this.filteredLogs = [];
      this.logsCountChanged.emit(0);
    }
  }
  
  clearLogs(): void {
    this.logger.clearLogs();
    this.logs = [];
    this.filteredLogs = [];
    this.logsCountChanged.emit(0);
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
  
  applyFilters(): void {
    this.filteredLogs = this.logs.filter(log => {
      // Filter by level
      if (this.filterLevel !== 'all' && LogLevel[log.level].toLowerCase() !== this.filterLevel) {
        return false;
      }
      
      // Filter by search text
      if (this.searchText && !this.logContainsText(log, this.searchText)) {
        return false;
      }
      
      return true;
    });
  }
  
  logContainsText(log: LogEntry, text: string): boolean {
    const searchText = text.toLowerCase();
    return (
      log.message.toLowerCase().includes(searchText) ||
      LogLevel[log.level].toLowerCase().includes(searchText) ||
      JSON.stringify(log.data || {}).toLowerCase().includes(searchText)
    );
  }
  
  getLogLevelString(level: LogLevel): string {
    return LogLevel[level].toLowerCase();
  }
} 