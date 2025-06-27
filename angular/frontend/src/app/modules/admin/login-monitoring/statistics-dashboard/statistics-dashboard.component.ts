import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoginMonitoringService } from '../shared/login-monitoring.service';
import { LoginMonitoringSharedModule } from '../shared/login-monitoring-shared.module';
import { Statistics } from '../shared/login-monitoring.models';

@Component({
  selector: 'app-statistics-dashboard',
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: './statistics-dashboard.component.html',
  styleUrls: ['./statistics-dashboard.component.scss']
})
export class StatisticsDashboardComponent implements OnInit {
  @Input() hasPermission = false;
  @Output() statsLoaded = new EventEmitter<Statistics>();

  statistics: Statistics | null = null;
  loading = false;

  constructor(
    private loginMonitoringService: LoginMonitoringService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    if (this.hasPermission) {
      this.loadStats();
    }
  }

  loadStats(): void {
    if (!this.hasPermission) return;
    
    this.loading = true;
    
    this.loginMonitoringService.getStatistics().subscribe({
      next: (data) => {
        this.statistics = data;
        this.loading = false;
        this.statsLoaded.emit(data);
      },
      error: (error) => {
        console.error('Error loading statistics:', error);
        this.snackBar.open('Failed to load statistics', 'Close', { duration: 5000 });
        this.loading = false;
      }
    });
  }

  refreshStats(): void {
    this.loadStats();
  }
} 