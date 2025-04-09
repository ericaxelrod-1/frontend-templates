import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-password-change',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatProgressBarModule
  ],
  template: `
    <div class="password-change-container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Change Password</mat-card-title>
        </mat-card-header>
        
        <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>
        
        <mat-card-content>
          <form [formGroup]="passwordForm" (ngSubmit)="onSubmit()">
            <mat-form-field appearance="outline">
              <mat-label>Current Password</mat-label>
              <input
                matInput
                type="password"
                formControlName="currentPassword"
                required
              />
              <mat-error *ngIf="f['currentPassword'].errors?.['required']">
                Current password is required
              </mat-error>
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>New Password</mat-label>
              <input
                matInput
                type="password"
                formControlName="newPassword"
                required
              />
              <mat-error *ngIf="f['newPassword'].errors?.['required']">
                New password is required
              </mat-error>
              <mat-error *ngIf="f['newPassword'].errors?.['minlength']">
                Password must be at least 8 characters
              </mat-error>
            </mat-form-field>
            
            <mat-form-field appearance="outline">
              <mat-label>Confirm New Password</mat-label>
              <input
                matInput
                type="password"
                formControlName="confirmPassword"
                required
              />
              <mat-error *ngIf="f['confirmPassword'].errors?.['required']">
                Please confirm your password
              </mat-error>
              <mat-error *ngIf="f['confirmPassword'].errors?.['mustMatch']">
                Passwords must match
              </mat-error>
            </mat-form-field>
            
            <div class="form-actions">
              <button 
                mat-flat-button 
                color="primary" 
                type="submit" 
                [disabled]="loading || passwordForm.invalid"
              >
                Change Password
              </button>
              <button 
                mat-stroked-button 
                type="button" 
                [disabled]="loading"
                (click)="cancel()"
              >
                Cancel
              </button>
            </div>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .password-change-container {
      max-width: 500px;
      margin: 0 auto;
      padding: 20px;
    }
    
    mat-form-field {
      width: 100%;
      margin-bottom: 16px;
    }
    
    .form-actions {
      display: flex;
      gap: 16px;
      margin-top: 16px;
    }
    
    button {
      flex: 1;
    }
  `]
})
export class PasswordChangeComponent implements OnInit {
  passwordForm!: FormGroup;
  loading = false;

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.passwordForm = this.formBuilder.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required]
    }, {
      validators: this.mustMatch('newPassword', 'confirmPassword')
    });
  }

  // Convenience getter for form fields
  get f() {
    return this.passwordForm.controls;
  }

  onSubmit(): void {
    if (this.passwordForm.invalid) {
      return;
    }

    this.loading = true;
    
    this.authService.changePassword(this.passwordForm.value).subscribe({
      next: () => {
        this.loading = false;
        this.snackBar.open('Password changed successfully', 'Close', {
          duration: 3000
        });
        this.router.navigate(['/app/profile'], { queryParams: { passwordChanged: 'true' } });
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(
          error?.error?.message || 'Failed to change password. Please try again.',
          'Close',
          { duration: 5000 }
        );
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/app/profile']);
  }

  private mustMatch(controlName: string, matchingControlName: string) {
    return (formGroup: FormGroup) => {
      const control = formGroup.controls[controlName];
      const matchingControl = formGroup.controls[matchingControlName];

      if (matchingControl.errors && !matchingControl.errors['mustMatch']) {
        // Return if another validator has already found an error on the matchingControl
        return;
      }

      // Set error on matchingControl if validation fails
      if (control.value !== matchingControl.value) {
        matchingControl.setErrors({ mustMatch: true });
      } else {
        matchingControl.setErrors(null);
      }
    };
  }
} 