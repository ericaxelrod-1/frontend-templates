import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PrivacyService, PrivacyTicket } from './privacy.service';

@Component({
  selector: 'app-support-ticket-dialog',
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
    MatSelectModule,
    MatSnackBarModule
  ],
  template: `
    <h2 mat-dialog-title>Submit Privacy Request</h2>
    <mat-dialog-content>
      <div *ngIf="!submitted && !loading && !error" class="ticket-form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Request Type</mat-label>
          <mat-select [(ngModel)]="requestType" required>
            <mat-option value="access">Data Access Request (GDPR Art. 15)</mat-option>
            <mat-option value="deletion">Data Deletion Request (GDPR Art. 17)</mat-option>
            <mat-option value="correction">Data Correction Request (GDPR Art. 16)</mat-option>
            <mat-option value="restriction">Processing Restriction (GDPR Art. 18)</mat-option>
            <mat-option value="objection">Processing Objection (GDPR Art. 21)</mat-option>
            <mat-option value="portability">Data Portability (GDPR Art. 20)</mat-option>
            <mat-option value="other">Other Request</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Description</mat-label>
          <textarea matInput 
                    [(ngModel)]="description" 
                    rows="5" 
                    placeholder="Please describe your request in detail..."
                    required></textarea>
        </mat-form-field>

        <p class="note">We'll respond to your request within 30 days as required by GDPR.</p>
      </div>

      <div *ngIf="loading" class="loading-state">
        <mat-spinner diameter="40"></mat-spinner>
        <p>Submitting your request...</p>
      </div>

      <div *ngIf="error" class="error-state">
        <mat-icon>error</mat-icon>
        <p>{{ error }}</p>
      </div>

      <div *ngIf="submitted" class="success-state">
        <mat-icon>check_circle</mat-icon>
        <p>Your request has been submitted!</p>
        <p class="note">Ticket #{{ ticketId }} - We'll respond within 30 days.</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">{{ submitted ? 'Close' : 'Cancel' }}</button>
      <button mat-raised-button color="primary" 
              (click)="submitTicket()" 
              *ngIf="!submitted"
              [disabled]="!requestType || !description || loading">
        Submit Request
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .ticket-form {
      min-width: 400px;
    }
    
    .full-width {
      width: 100%;
      margin-bottom: 1rem;
    }
    
    .note {
      color: #666;
      font-size: 0.9rem;
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
  `]
})
export class SupportTicketDialogComponent {
  requestType = '';
  description = '';
  loading = false;
  error: string | null = null;
  submitted = false;
  ticketId: number | null = null;

  constructor(
    private privacyService: PrivacyService,
    private dialogRef: MatDialogRef<SupportTicketDialogComponent>,
    private snackBar: MatSnackBar
  ) {}

  submitTicket(): void {
    this.loading = true;
    this.error = null;

    this.privacyService.createTicket(this.requestType, this.description).subscribe({
      next: (ticket) => {
        this.submitted = true;
        this.ticketId = ticket.id;
        this.loading = false;
        this.snackBar.open('Request submitted successfully', 'Close', { duration: 3000 });
      },
      error: (err) => {
        this.error = 'Failed to submit request. Please try again.';
        this.loading = false;
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}