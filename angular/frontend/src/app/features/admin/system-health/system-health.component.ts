import { Component, OnInit, OnDestroy } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { interval, Subject, takeUntil, Observable, map } from 'rxjs';
import { Store } from '@ngxs/store';
import { SystemHealthActions } from '../../../store/system-health/system-health.actions';
import { SystemHealthState } from '../../../store/system-health/system-health.state';
import {
  SystemHealth,
  SystemHealthStatus,
  ClearTempResult,
} from '../../../core/services/system-health.service';
import { FormatBytesPipe } from '../../../shared/pipes/format-bytes.pipe';

const POLL_INTERVAL_MS = 30000;

const STATUS_ICONS: Record<SystemHealthStatus, string> = {
  Healthy: 'check_circle',
  Warning: 'warning',
  Critical: 'error',
  Panic: 'report',
  Unknown: 'help',
};

@Component({
  selector: 'app-system-health',
  standalone: true,
  imports: [
    AsyncPipe,
    DatePipe,
    MatCardModule,
    MatProgressBarModule,
    MatIconModule,
    MatButtonModule,
    FormatBytesPipe,
  ],
  template: `
    <div class="health-container">
      <div class="header">
        <h1>System Health &amp; Sentinel</h1>
        <div
          class="status-badge"
          [class.Healthy]="(status$ | async) === 'Healthy'"
          [class.Warning]="(status$ | async) === 'Warning'"
          [class.Critical]="(status$ | async) === 'Critical' || (status$ | async) === 'Panic'"
          [class.Unknown]="(status$ | async) === 'Unknown'"
        >
          <mat-icon aria-hidden="true">{{ statusIcon$ | async }}</mat-icon>
          {{ status$ | async }}
        </div>
      </div>

      @if (error$ | async; as error) {
        <mat-card class="error-card">
          <mat-card-content>Health check failed: {{ error }}</mat-card-content>
        </mat-card>
      }

      @if (health$ | async; as health) {
        @if (health.guardDisabled) {
          <mat-card class="override-card">
            <mat-card-content>
              <strong>DISABLE_SENTINEL_GUARD is set.</strong>
              The resource guard is open: heavy routes and writes are being
              served despite the disk being above its thresholds. The figures
              below are the real measurement — nothing here is suppressed.
            </mat-card-content>
          </mat-card>
        }

        @if (health.lastError; as lastError) {
          <mat-card class="error-card">
            <mat-card-content>
              The Sentinel could not read the disk, so the status is
              <strong>Unknown</strong>, not Healthy: {{ lastError }}
            </mat-card-content>
          </mat-card>
        }

        <div class="stats-grid">
          <mat-card class="stat-card">
            <mat-card-header>
              <mat-icon mat-card-avatar aria-hidden="true">storage</mat-icon>
              <mat-card-title>Disk Usage</mat-card-title>
              <mat-card-subtitle>
                {{ health.disk.used | formatBytes }} / {{ health.disk.total | formatBytes }}
              </mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              <div class="progress-container">
                <mat-progress-bar
                  mode="determinate"
                  [value]="health.disk.percentage"
                  [color]="progressColor(health.disk.percentage)"
                ></mat-progress-bar>
                <span class="percentage">{{ health.disk.percentage }}%</span>
              </div>
            </mat-card-content>
          </mat-card>

          <mat-card class="stat-card">
            <mat-card-header>
              <mat-icon mat-card-avatar aria-hidden="true">memory</mat-icon>
              <mat-card-title>Host Memory Usage</mat-card-title>
              <mat-card-subtitle>
                {{ health.memory.used | formatBytes }} / {{ health.memory.total | formatBytes }}
              </mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              <div class="progress-container">
                <mat-progress-bar
                  mode="determinate"
                  [value]="health.memory.percentage"
                  [color]="progressColor(health.memory.percentage)"
                ></mat-progress-bar>
                <span class="percentage">{{ health.memory.percentage }}%</span>
              </div>
              <p class="note">
                This process: {{ health.process.rss | formatBytes }} resident —
                one process, not the host.
              </p>
            </mat-card-content>
          </mat-card>

          <mat-card class="stat-card">
            <mat-card-header>
              <mat-icon mat-card-avatar aria-hidden="true">run_circle</mat-icon>
              <mat-card-title>Active Jobs</mat-card-title>
              <mat-card-subtitle>Background privacy processing</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              <div class="job-count">{{ health.activeJobs }}</div>
              <p>Requests pending in queue ({{ health.pendingTickets }} open tickets)</p>
            </mat-card-content>
          </mat-card>
        </div>

        @if (health.status !== 'Healthy' && health.status !== 'Unknown') {
          <mat-card class="maintenance-card">
            <mat-card-header>
              <mat-card-title>Maintenance Toolkit</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p>
                System resources are limited. Privacy exports and other heavy
                operations are currently restricted.
                @if (health.status === 'Panic') {
                  All writes are halted until disk usage drops below
                  {{ health.thresholds.panicPercent }}%.
                } @else {
                  They resume when disk usage drops below
                  {{ health.thresholds.criticalPercent }}%.
                }
              </p>

              @if (cleanup$ | async; as cleanup) {
                <p class="cleanup-result">
                  Removed {{ cleanup.removedFiles }} of {{ cleanup.scannedFiles }}
                  expired export files ({{ cleanup.freedBytes }} bytes freed).
                  @if (cleanup.errors.length) {
                    <span class="cleanup-errors">
                      {{ cleanup.errors.length }} file(s) could not be removed.
                    </span>
                  }
                </p>
              }

              <div class="action-buttons">
                <button
                  mat-raised-button
                  color="warn"
                  type="button"
                  (click)="clearTempFiles()"
                  [disabled]="(isLoading$ | async) === true"
                >
                  <mat-icon aria-hidden="true">delete_sweep</mat-icon>
                  Clear Expired Exports
                </button>
                <button mat-stroked-button type="button" (click)="refreshHealth()">
                  <mat-icon aria-hidden="true">refresh</mat-icon>
                  Retry Health Check
                </button>
              </div>
            </mat-card-content>
          </mat-card>
        }

        <div class="footer-info">
          Last checked: {{ health.lastCheck ? (health.lastCheck | date: 'medium') : 'never' }}
        </div>
      }
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
      &.Unknown { background-color: #eceff1; color: #455a64; }
    }
    .error-card, .override-card {
      margin-bottom: 1.5rem;
      &.override-card { border-left: 5px solid #ff9800; }
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
      .note { font-size: 0.8rem; color: #666; margin-top: 0.75rem; }
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
      .cleanup-result { margin-top: 0.75rem; font-weight: 500; }
      .cleanup-errors { color: #c62828; }
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
  /**
   * Bound through `store.select` rather than `@Select`.
   *
   * `@Select` installs a getter on the prototype; with `useDefineForClassFields`
   * (implied by `target: ES2022` and not disabled) the `foo$!: Observable<T>`
   * declaration is emitted as an own field initialised to `undefined`, which
   * shadows that getter. Every `@Select` field in this app is `undefined`; it
   * survives in templates only because AsyncPipe tolerates `null`, so a
   * store-bound value silently never renders.
   */
  readonly health$: Observable<SystemHealth | null>;
  readonly status$: Observable<SystemHealthStatus>;
  readonly isLoading$: Observable<boolean>;
  readonly error$: Observable<string | null>;
  readonly cleanup$: Observable<ClearTempResult | null>;
  readonly statusIcon$: Observable<string>;

  private destroy$ = new Subject<void>();

  constructor(private readonly store: Store) {
    this.health$ = store.select(SystemHealthState.getHealth);
    this.status$ = store.select(SystemHealthState.getStatus);
    this.isLoading$ = store.select(SystemHealthState.isLoading);
    this.error$ = store.select(SystemHealthState.error);
    this.cleanup$ = store.select(SystemHealthState.cleanup);
    // Derived in the stream rather than in the template: a template expression
    // re-runs on every change detection pass.
    this.statusIcon$ = this.status$.pipe(
      map((status) => STATUS_ICONS[status] ?? 'help'),
    );
  }

  ngOnInit(): void {
    this.store.dispatch(new SystemHealthActions.FetchHealth());

    interval(POLL_INTERVAL_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.store.dispatch(new SystemHealthActions.FetchHealth()));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  progressColor(percentage: number): 'primary' | 'accent' | 'warn' {
    if (percentage >= 95) return 'warn';
    if (percentage > 85) return 'accent';
    return 'primary';
  }

  refreshHealth(): void {
    this.store.dispatch(new SystemHealthActions.FetchHealth());
  }

  clearTempFiles(): void {
    this.store.dispatch(new SystemHealthActions.ClearTempFiles());
  }
}