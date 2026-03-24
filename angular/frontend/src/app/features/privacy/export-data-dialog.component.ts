import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PrivacyService, UserDataExport } from './privacy.service';

@Component({
  selector: 'app-export-data-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title>Export Your Data</h2>
    <mat-dialog-content>
      <div *ngIf="!exportedData && !loading && !error" class="export-info">
        <p>You can download a copy of all your personal data including:</p>
        <ul>
          <li>Profile information</li>
          <li>Login history</li>
          <li>Privacy preferences</li>
          <li>Security alerts</li>
        </ul>
        <p class="note">Data will be exported in JSON format.</p>
      </div>

      <div *ngIf="loading" class="loading-state">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Preparing your data export...</p>
      </div>

      <div *ngIf="error" class="error-state">
        <mat-icon>error</mat-icon>
        <p>{{ error }}</p>
      </div>

      <div *ngIf="exportedData" class="success-state">
        <mat-icon>check_circle</mat-icon>
        <p>Your data is ready for download!</p>
        <button mat-raised-button color="primary" (click)="downloadData()">
          <mat-icon>download</mat-icon>
          Download JSON
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Close</button>
      <button mat-raised-button color="primary" 
              (click)="requestExport()" 
              *ngIf="!exportedData && !loading"
              [disabled]="loading">
        Request Export
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .export-info {
      ul {
        margin: 1rem 0;
        padding-left: 1.5rem;
        li {
          margin: 0.5rem 0;
        }
      }
      .note {
        color: #666;
        font-size: 0.9rem;
      }
    }
    .loading-state, .error-state, .success-state {
      text-align: center;
      padding: 2rem;
      
      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 1rem;
      }
    }
    .error-state mat-icon {
      color: #f44336;
    }
    .success-state mat-icon {
      color: #4caf50;
    }
  `]
})
export class ExportDataDialogComponent implements OnInit {
  loading = false;
  exportedData: UserDataExport | null = null;
  error: string | null = null;

  constructor(
    private privacyService: PrivacyService,
    private dialogRef: MatDialogRef<ExportDataDialogComponent>,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {}

  requestExport(): void {
    this.loading = true;
    this.error = null;
    
    this.privacyService.exportData().subscribe({
      next: (data) => {
        this.exportedData = data;
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Failed to prepare data export. Please try again.';
        this.loading = false;
      }
    });
  }

  downloadData(): void {
    if (this.exportedData) {
      const jsonStr = JSON.stringify(this.exportedData.data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-data-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      this.snackBar.open('Download started', 'Close', { duration: 3000 });
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}