import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';

interface SystemHealth {
  status: 'Healthy' | 'Warning' | 'Critical';
  disk: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  activeJobs: number;
  lastCheck: string;
}

@Component({
  selector: 'app-system-health',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressBarModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule
  ],
  template: `
    <div class="health-container">
      <div class="header">
        <h1>System Health & Sentinel</h1>
        <div class="status-badge" [ngClass]="health?.status || 'unknown'">
          <mat-icon>{{ getStatusIcon() }}</mat-icon>
          {{ health?.status || 'Checking...' }}
        </div>
      </div>

      <div class="stats-grid" *ngIf="health">
        <mat-card class="stat-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>storage</mat-icon>
            <mat-card-title>Disk Usage</mat-card-title>
            <mat-card-subtitle>{{ formatBytes(health.disk.used) }} / {{ formatBytes(health.disk.total) }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="progress-container">
              <mat-progress-bar mode="determinate" [value]="health.disk.percentage" 
                               [color]="getProgressBarColor(health.disk.percentage)"></mat-progress-bar>
              <span class="percentage">{{ health.disk.percentage }}%</span>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>memory</mat-icon>
            <mat-card-title>Memory Usage</mat-card-title>
            <mat-card-subtitle>{{ formatBytes(health.memory.used) }} / {{ formatBytes(health.memory.total) }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="progress-container">
              <mat-progress-bar mode="determinate" [value]="health.memory.percentage"
                               [color]="getProgressBarColor(health.memory.percentage)"></mat-progress-bar>
              <span class="percentage">{{ health.memory.percentage }}%</span>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>run_circle</mat-icon>
            <mat-card-title>Active Jobs</mat-card-title>
            <mat-card-subtitle>Background privacy processing</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="job-count">{{ health.activeJobs }}</div>
            <p>Requests pending in queue</p>
          </mat-card-content>
        </mat-card>
      </div>

      <mat-card class="maintenance-card" *ngIf="health?.status !== 'Healthy'">
        <mat-card-header>
          <mat-card-title>Maintenance Toolkit</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p>System resources are limited. Privacy exports and other heavy operations are currently restricted.</p>
          <div class="action-buttons">
            <button mat-raised-button color="warn" (click)="clearTempFiles()">
              <mat-icon>delete_sweep</mat-icon>
              Clear Temporary Files
            </button>
            <button mat-stroked-button (click)="refreshHealth()">
              <mat-icon>refresh</mat-icon>
              Retry Health Check
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      <div class="footer-info" *ngIf="health">
        Last checked: {{ health.lastCheck | date:'mediumTime' }}
      </div>
    </div>
  `,
  styles: [`
    .health-container {
      padding: 2rem;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      h1 { margin: 0; }
    }
    .status-badge {
      display: flex;
      align-items: center;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-weight: bold;
      gap: 8px;
      &.Healthy { background-color: #e8f5e9; color: #2e7d32; }
      &.Warning { background-color: #fff3e0; color: #ef6c00; }
      &.Critical { background-color: #ffebee; color: #c62828; }
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      .progress-container {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 1rem;
        mat-progress-bar { flex: 1; height: 8px; border-radius: 4px; }
        .percentage { font-weight: bold; width: 40px; text-align: right; }
      }
      .job-count {
        font-size: 3rem;
        font-weight: bold;
        color: #3f51b5;
        margin: 1rem 0;
      }
    }
    .maintenance-card {
      border-left: 5px solid #ff9800;
      .action-buttons {
        display: flex;
        gap: 1rem;
        margin-top: 1rem;
      }
    }
    .footer-info {
      margin-top: 2rem;
      color: #666;
      font-size: 0.85rem;
      text-align: right;
    }
  `]
})
export class SystemHealthComponent implements OnInit, OnDestroy {
  health: SystemHealth | null = null;
  private sub: Subscription | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.sub = interval(30000)
      .pipe(
        startWith(0),
        switchMap(() => this.http.get<SystemHealth>('/api/admin/system-health'))
      )
      .subscribe({
        next: (data) => this.health = data,
        error: (err) => console.error('Failed to fetch health data', err)
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  getStatusIcon(): string {
    switch (this.health?.status) {
      case 'Healthy': return 'check_circle';
      case 'Warning': return 'warning';
      case 'Critical': return 'error';
      default: return 'help';
    }
  }

  getProgressBarColor(percentage: number): 'primary' | 'accent' | 'warn' {
    if (percentage > 95) return 'warn';
    if (percentage > 85) return 'accent';
    return 'primary';
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  refreshHealth(): void {
    this.http.get<SystemHealth>('/api/admin/system-health').subscribe(data => this.health = data);
  }

  clearTempFiles(): void {
    this.http.post('/api/admin/system-health/clear-temp', {}).subscribe(() => {
      this.refreshHealth();
    });
  }
}
