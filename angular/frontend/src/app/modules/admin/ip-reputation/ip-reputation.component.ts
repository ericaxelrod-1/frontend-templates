import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { IpReputationService } from './shared/ip-reputation.service';
import { PermissionService } from '../../../core/services/permission.service';
import { IPReputation } from '../login-monitoring/shared/login-monitoring.models';

@Component({
  selector: 'app-ip-reputation',
  templateUrl: './ip-reputation.component.html',
  styleUrls: ['./ip-reputation.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatChipsModule,
    MatCardModule
  ]
})
export class IpReputationComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private destroy$ = new Subject<void>();
  
  // Permission management
  hasPermission = false;
  loading = false;
  
  // Data properties
  selectedIpReputation: IPReputation | null = null;
  ipReputations: IPReputation[] = [];
  
  // Display columns for table
  displayedColumns: string[] = ['ipAddress', 'failedAttempts', 'reputation', 'status', 'lastAttempt', 'actions'];

  constructor(
    private ipReputationService: IpReputationService,
    private permissionService: PermissionService
  ) {}

  ngOnInit(): void {
    this.checkPermissions();
  }

  ngAfterViewInit(): void {
    // Component is ready after view init
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkPermissions(): void {
    this.permissionService.hasPermission('login-monitoring:read')
      .pipe(takeUntil(this.destroy$))
      .subscribe(hasPermission => {
        this.hasPermission = hasPermission;
        if (hasPermission) {
          this.loadIPReputations();
        }
      });
  }

  private loadIPReputations(): void {
    this.loading = true;
    // This would need to be implemented in the service
    // For now, show empty state
    this.loading = false;
  }

  // Event handlers
  onIPSelected(ipAddress: string): void {
    this.ipReputationService.getIPReputation(ipAddress)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (reputation: any) => {
          this.selectedIpReputation = reputation;
        },
        error: (error: any) => {
          console.error('Error loading IP reputation:', error);
        }
      });
  }

  blockIP(ipAddress: string): void {
    this.ipReputationService.blockIP(ipAddress)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadIPReputations();
          if (this.selectedIpReputation?.ipAddress === ipAddress) {
            this.onIPSelected(ipAddress);
          }
        },
        error: (error: any) => {
          console.error('Error blocking IP:', error);
        }
      });
  }

  unblockIP(ipAddress: string): void {
    this.ipReputationService.unblockIP(ipAddress)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadIPReputations();
          if (this.selectedIpReputation?.ipAddress === ipAddress) {
            this.onIPSelected(ipAddress);
          }
        },
        error: (error: any) => {
          console.error('Error unblocking IP:', error);
        }
      });
  }

  // Utility methods
  getReputationClass(reputation: number): string {
    if (reputation >= 80) return 'reputation-good';
    if (reputation >= 50) return 'reputation-medium';
    if (reputation >= 20) return 'reputation-poor';
    return 'reputation-bad';
  }

  getStatusClass(isBlocked: boolean): string {
    return isBlocked ? 'status-blocked' : 'status-active';
  }

  formatReputationScore(reputation: number): string {
    return `${reputation}/100`;
  }

  // Test data methods
  createTestIPData(): void {
    // IP reputation doesn't have test pattern creation
    // This would need to be implemented in the IpReputationService if needed
    console.log('Test IP data creation not implemented for IP reputation');
  }

  clearAllData(): void {
    // IP reputation doesn't have test data clearing
    // This would need to be implemented in the IpReputationService if needed
    console.log('Test data clearing not implemented for IP reputation');
  }
} 