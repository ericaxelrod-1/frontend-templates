import { Component, OnInit, Input, Output, EventEmitter, OnDestroy } from "@angular/core";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Observable, Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { LoginMonitoringService } from "../shared/login-monitoring.service";
import { LoginMonitoringSharedModule } from "../shared/login-monitoring-shared.module";
import { Statistics } from "../shared/login-monitoring.models";
import { ResponsiveLayoutService } from "../../../../shared/services/responsive-layout.service";

@Component({
  selector: "app-statistics-dashboard",
  standalone: true,
  imports: [LoginMonitoringSharedModule],
  templateUrl: "./statistics-dashboard.component.html",
  styleUrls: ["./statistics-dashboard.component.scss"]
})
export class StatisticsDashboardComponent implements OnInit, OnDestroy {
  @Input() hasPermission = false;
  @Output() statsLoaded = new EventEmitter<Statistics>();

  statistics: Statistics | null = null;
  loading = false;
  private destroy$ = new Subject<void>();

  // Responsive observables (initialized in constructor)
  responsiveClass$!: Observable<string>;
  gridColumns$!: Observable<string>;

  constructor(
    private loginMonitoringService: LoginMonitoringService,
    private snackBar: MatSnackBar,
    private responsiveLayout: ResponsiveLayoutService
  ) {
    // Initialize responsive observables
    this.responsiveClass$ = this.responsiveLayout.getResponsiveClass();
    this.gridColumns$ = this.responsiveLayout.getGridColumns("stats");
  }

  ngOnInit(): void {
    if (this.hasPermission) {
      this.loadStats();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats(): void {
    if (!this.hasPermission) return;
    
    this.loading = true;
    
    this.loginMonitoringService.getStatistics()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.statistics = data;
          this.loading = false;
          this.statsLoaded.emit(data);
        },
        error: (error) => {
          console.error("Error loading statistics:", error);
          this.snackBar.open("Failed to load statistics", "Close", { duration: 5000 });
          this.loading = false;
        }
      });
  }

  refreshStats(): void {
    this.loadStats();
  }
}
