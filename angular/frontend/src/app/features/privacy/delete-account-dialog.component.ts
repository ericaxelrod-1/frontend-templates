import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PrivacyService } from './privacy.service';

@Component({
  selector: 'app-delete-account-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title>Delete Account</h2>
    <mat-dialog-content>
      <div *ngIf="!success && !loading && !error" class="warning-content">
        <mat-icon class="warning-icon">warning</mat-icon>
        <p><strong>This action cannot be undone.</strong></p>
        <p>Deleting your account will permanently remove:</p>
        <ul>
          <li>Your profile and personal information</li>
          <li>All your preferences and settings</li>
          <li>Login history and activity data</li>
        </ul>
        <p class="note">After deletion, you may not be able to recover your data.</p>
        
        <mat-form-field appearance="outline" class="confirm-field">
          <mat-label>Type "DELETE" to confirm</mat-label>
          <input matInput [(ngModel)]="confirmationText" placeholder="DELETE">
        </mat-form-field>
      </div>

      <div *ngIf="loading" class="loading-state">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Deleting your account...</p>
      </div>

      <div *ngIf="error" class="error-state">
        <mat-icon>error</mat-icon>
        <p>{{ error }}</p>
      </div>

      <div *ngIf="success" class="success-state">
        <mat-icon>check_circle</mat-icon>
        <p>Your account has been deleted.</p>
        <p class="note">You will be redirected shortly...</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Cancel</button>
      <button mat-raised-button color="warn" 
              (click)="deleteAccount()" 
              *ngIf="!success"
              [disabled]="confirmationText !== 'DELETE' || loading">
        Delete My Account
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .warning-content {
      text-align: center;
      
      .warning-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: #f44336;
        margin-bottom: 1rem;
      }
      
      ul {
        text-align: left;
        margin: 1rem 0;
        padding-left: 1.5rem;
      }
      
      .note {
        color: #666;
        font-size: 0.9rem;
      }
    }
    
    .confirm-field {
      width: 100%;
      margin-top: 1rem;
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
    
    .note {
      color: #666;
    }
  `]
})
export class DeleteAccountDialogComponent {
  confirmationText = '';
  loading = false;
  error: string | null = null;
  success = false;

  constructor(
    private privacyService: PrivacyService,
    private dialogRef: MatDialogRef<DeleteAccountDialogComponent>,
    private snackBar: MatSnackBar
  ) {}

  deleteAccount(): void {
    this.loading = true;
    this.error = null;

    this.privacyService.deleteAccount().subscribe({
      next: (result) => {
        if (result.success) {
          this.success = true;
          this.snackBar.open('Account deleted successfully', 'Close', { duration: 3000 });
          setTimeout(() => {
            this.dialogRef.close('deleted');
          }, 2000);
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Failed to delete account. Please try again.';
        this.loading = false;
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}