import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PrivacyService } from './privacy.service';
import { StandardCaptchaComponent } from '../../shared/components/captcha/standard/standard-captcha.component';
import { CustomValidators } from '../../core/validators/custom-validators';
import { LoggerService } from '../../services/logging/logger.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-public-privacy-request',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    StandardCaptchaComponent
  ],
  template: `
    <div class="public-privacy-container">
      <mat-card class="request-card">
        <mat-card-header>
          <mat-card-title>Privacy Rights Request</mat-card-title>
          <mat-card-subtitle>Exercise your data privacy rights without an account</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <form [formGroup]="requestForm" (ngSubmit)="submitRequest()" *ngIf="!submitted">
            <p class="instruction">
              Use this form to request access, deletion, or portability of your personal data.
              We will send a verification link to your email to confirm your identity.
            </p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Email Address</mat-label>
              <input matInput formControlName="email" type="email" placeholder="email@example.com">
              <mat-error *ngIf="f['email']?.hasError('required')">Email is required</mat-error>
              <mat-error *ngIf="f['email']?.hasError('email')">Please enter a valid email</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Request Type</mat-label>
              <mat-select formControlName="requestType">
                <mat-option value="export">Right to Access (Export)</mat-option>
                <mat-option value="erasure">Right to Erasure (Delete)</mat-option>
                <mat-option value="correction">Right to Rectification (Correct)</mat-option>
                <mat-option value="portability">Data Portability</mat-option>
                <mat-option value="objection">Object to Processing</mat-option>
              </mat-select>
              <mat-error *ngIf="f['requestType']?.hasError('required')">Request type is required</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Request Details</mat-label>
              <textarea matInput formControlName="description" rows="4"
                        placeholder="Please provide details about your request..."></textarea>
              <mat-error *ngIf="f['description']?.hasError('required')">Details are required</mat-error>
              <mat-error *ngIf="f['description']?.hasError('minlength')">
                Please provide more details (minimum 10 characters)
              </mat-error>
            </mat-form-field>

            <div class="captcha-section">
              <label>Verify you're human</label>
              <app-standard-captcha #captcha
                  formControlName="captcha"
                  [ngClass]="{ 'is-invalid': submitted && f['captcha'].errors }">
              </app-standard-captcha>
              <mat-error *ngIf="submitted && f['captcha'].errors">
                Please solve the CAPTCHA correctly.
              </mat-error>
            </div>

            <div class="actions">
              <button mat-raised-button color="primary" type="submit"
                      [disabled]="loading">
                <mat-spinner diameter="20" *ngIf="loading" class="spinner"></mat-spinner>
                Submit Request
              </button>
            </div>
          </form>

          <div class="success-message" *ngIf="submitted">
            <mat-icon class="success-icon">mark_email_read</mat-icon>
            <h3>Request Submitted!</h3>
            <p>
              We have sent a verification link to <strong>{{ f['email'].value }}</strong>.
              Please click the link in that email to confirm your request.
            </p>
            <p class="note">
              Verification links are valid for {{ verificationWindowHours }} hours. Check your spam folder if you don't see it.
            </p>
            <button mat-button color="primary" (click)="reset()">Submit Another Request</button>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .public-privacy-container {
      display: flex;
      justify-content: center;
      padding: 2rem;
      min-height: 100vh;
      background-color: #f5f5f5;
    }
    .request-card {
      max-width: 600px;
      width: 100%;
    }
    .full-width {
      width: 100%;
      margin-bottom: 1rem;
    }
    .instruction {
      margin-bottom: 1.5rem;
      color: #555;
    }
    .captcha-section {
      margin: 1.5rem 0;
    }
    .captcha-section label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 1rem;
    }
    .spinner {
      display: inline-block;
      margin-right: 8px;
    }
    .success-message {
      text-align: center;
      padding: 2rem 0;
      .success-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        color: #4caf50;
        margin-bottom: 1rem;
      }
      h3 {
        font-size: 1.5rem;
        margin-bottom: 1rem;
      }
      .note {
        margin: 1.5rem 0;
        font-size: 0.9rem;
        color: #666;
      }
    }
  `]
})
export class PublicPrivacyComponent implements OnInit {
  @ViewChild('captcha') captcha!: StandardCaptchaComponent;
  requestForm: FormGroup;
  loading = false;
  submitted = false;
  verificationWindowHours = environment.privacy.verificationWindowHours;

  constructor(
    private fb: FormBuilder,
    private privacyService: PrivacyService,
    private snackBar: MatSnackBar,
    private logger: LoggerService
  ) {
    this.requestForm = this.fb.group({
      email: ['', [Validators.required, CustomValidators.email()]],
      requestType: ['', [Validators.required]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      captcha: [null, Validators.required]
    });
  }

  ngOnInit(): void {}

  get f() { return this.requestForm.controls; }

  submitRequest(): void {
    this.submitted = true;
    this.requestForm.markAllAsTouched();

    if (this.requestForm.invalid) {
      return;
    }

    const captchaData = this.requestForm.get('captcha')?.value;
    if (!captchaData) {
      return;
    }

    this.loading = true;

    const data = {
      email: this.requestForm.value.email,
      requestType: this.requestForm.value.requestType,
      description: this.requestForm.value.description,
      captchaToken: captchaData.captchaToken,
      captchaSolution: captchaData.captchaSolution
    };

    this.privacyService.createPublicTicket(data).subscribe({
      next: () => {
        this.loading = false;
        this.submitted = true;
      },
      error: (err) => {
        this.loading = false;
        this.submitted = false; // Reset to allow retry
        const errorMsg = err?.error?.message || 'Failed to submit request.';
        this.snackBar.open(errorMsg, 'Close', { duration: 5000 });
        this.captcha?.refreshChallenge();
      }
    });
  }

  reset(): void {
    this.submitted = false;
    this.requestForm.reset({
      email: '',
      requestType: '',
      description: '',
      captcha: null
    });
    this.captcha?.refreshChallenge();
  }
}
