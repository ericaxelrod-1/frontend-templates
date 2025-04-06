import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PasswordChangeRequest, User } from '../../../models';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LoggerService } from '../../../services/logging/logger.service';

@Component({
  selector: 'app-change-password',
  templateUrl: './change-password.component.html',
  styleUrls: ['./change-password.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule
  ]
})
export class ChangePasswordComponent implements OnInit {
  changePasswordForm: FormGroup;
  submitted = false;
  loading = false;
  currentUser: User | null = null;
  isRequiredChange = false;

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private logger: LoggerService
  ) {
    this.logger.info('ChangePasswordComponent constructor called');
    
    this.changePasswordForm = this.formBuilder.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [
        Validators.required, 
        Validators.minLength(8),
        Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
      ]],
      confirmPassword: ['', Validators.required]
    }, {
      validator: this.matchPasswords('newPassword', 'confirmPassword')
    });
    
    this.logger.debug('ChangePasswordForm initialized:', this.changePasswordForm);
  }

  ngOnInit(): void {
    this.logger.info('ChangePasswordComponent ngOnInit called');
    
    // Get the current user
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.logger.debug('Current user loaded:', user ? user.email : 'null');
      
      if (user?.requiresPasswordChange) {
        this.isRequiredChange = true;
        this.logger.info('User requires password change');
      }
    });
  }

  // Custom validator to check that two fields match
  matchPasswords(controlName: string, matchingControlName: string) {
    return (formGroup: FormGroup) => {
      const control = formGroup.controls[controlName];
      const matchingControl = formGroup.controls[matchingControlName];

      if (matchingControl.errors && !matchingControl.errors['mustMatch']) {
        // return if another validator has already found an error on the matchingControl
        return;
      }

      // set error on matchingControl if validation fails
      if (control.value !== matchingControl.value) {
        matchingControl.setErrors({ mustMatch: true });
        this.logger.debug('Password match validation failed');
      } else {
        matchingControl.setErrors(null);
        this.logger.debug('Password match validation passed');
      }
    };
  }

  // convenience getter for easy access to form fields
  get f() { return this.changePasswordForm.controls; }

  onSubmit() {
    this.logger.info('ChangePasswordComponent onSubmit called');
    this.submitted = true;

    // stop here if form is invalid
    if (this.changePasswordForm.invalid) {
      this.logger.warn('Form is invalid');
      
      // Log specifics about which controls are invalid
      Object.keys(this.f).forEach(key => {
        const control = this.f[key];
        if (control.invalid) {
          this.logger.warn(`Control ${key} is invalid:`, control.errors);
        }
      });
      
      return;
    }

    this.loading = true;
    this.logger.info('Submitting password change request');

    const passwordChangeRequest: PasswordChangeRequest = {
      currentPassword: this.f['currentPassword'].value,
      newPassword: this.f['newPassword'].value,
      confirmPassword: this.f['confirmPassword'].value
    };

    this.authService.changePassword(passwordChangeRequest)
      .subscribe({
        next: (response) => {
          this.loading = false;
          this.logger.info('Password changed successfully', response);
          
          // Show success message
          this.router.navigate(['/profile'], { queryParams: { passwordChanged: 'true' } });
          
          // If this was a required password change, navigate to dashboard
          if (this.isRequiredChange) {
            this.logger.info('Redirecting to dashboard after required password change');
            this.router.navigate(['/dashboard']);
          }
        },
        error: (error) => {
          this.loading = false;
          this.logger.error('Failed to change password:', error);
        }
      });
  }
} 