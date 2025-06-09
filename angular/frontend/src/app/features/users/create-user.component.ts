import { Component, OnInit, Inject, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { LoggerService } from '../../services/logging/logger.service';
import { RoleService, Role } from '../../services/role.service';
import { PermissionService } from '../../core/services/permission.service';
import { PasswordGeneratorService, PasswordStrengthResult } from '../../core/services/password-generator.service';

@Component({
  selector: 'app-create-user',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSelectModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule
  ],
  template: `
    <div class="create-user-container">
      <h1>Create New User</h1>

      <div *ngIf="!hasPermission" class="permission-error">
        <p>You do not have permission to create users.</p>
        <button mat-raised-button color="primary" (click)="cancel()">Back to Users</button>
      </div>

      <form [formGroup]="userForm" (ngSubmit)="onSubmit()" *ngIf="hasPermission">
        <mat-form-field class="form-field" appearance="outline">
          <mat-label>Username</mat-label>
          <input matInput formControlName="username" required>
          <mat-error *ngIf="f['username'].hasError('required')">Username is required</mat-error>
        </mat-form-field>

        <mat-form-field class="form-field" appearance="outline">
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" required>
          <mat-error *ngIf="f['email'].hasError('required')">Email is required</mat-error>
          <mat-error *ngIf="f['email'].hasError('email')">Please enter a valid email</mat-error>
        </mat-form-field>

        <mat-form-field class="form-field" appearance="outline">
          <mat-label>First Name</mat-label>
          <input matInput formControlName="firstName">
        </mat-form-field>

        <mat-form-field class="form-field" appearance="outline">
          <mat-label>Last Name</mat-label>
          <input matInput formControlName="lastName">
        </mat-form-field>

        <!-- Password Generation Section -->
        <div class="password-section">
          <mat-form-field class="form-field password-field" appearance="outline">
            <mat-label>Password</mat-label>
            <input 
              matInput 
              [type]="hidePassword ? 'password' : 'text'" 
              formControlName="password" 
              required
              (input)="onPasswordChange()"
            >
            <button 
              mat-icon-button 
              matSuffix 
              type="button"
              (click)="togglePasswordVisibility()"
              [attr.aria-label]="'Hide password'"
              [attr.aria-pressed]="!hidePassword"
            >
              <mat-icon>{{hidePassword ? 'visibility' : 'visibility_off'}}</mat-icon>
            </button>
            <mat-error *ngIf="f['password'].hasError('required')">Password is required</mat-error>
            <mat-error *ngIf="f['password'].hasError('minlength')">Password must be at least 8 characters</mat-error>
          </mat-form-field>

          <div class="password-actions">
            <button 
              type="button" 
              mat-raised-button 
              color="accent" 
              (click)="generatePassword()"
              matTooltip="Generate a secure password"
            >
              <mat-icon>refresh</mat-icon>
              Generate Password
            </button>
          </div>

          <!-- Password Strength Indicator -->
          <div class="password-strength" *ngIf="passwordStrength">
            <div class="strength-header">
              <span class="strength-label">Password Strength: </span>
              <span class="strength-value" [ngClass]="getStrengthClass()">
                {{passwordStrength.message}}
              </span>
            </div>
            <mat-progress-bar 
              [value]="passwordStrength.score" 
              [ngClass]="getStrengthClass()"
            ></mat-progress-bar>
          </div>

          <!-- Password Requirements -->
          <div class="password-requirements" *ngIf="showRequirements">
            <h4>Password Requirements:</h4>
            <ul class="requirements-list">
              <li 
                *ngFor="let requirement of passwordRequirements; let i = index"
                [ngClass]="getRequirementClass(i)"
              >
                <mat-icon class="requirement-icon">
                  {{getRequirementIcon(i)}}
                </mat-icon>
                {{requirement}}
              </li>
            </ul>
          </div>
        </div>

        <mat-form-field class="form-field" appearance="outline">
          <mat-label>Role</mat-label>
          <mat-select formControlName="roleId">
            <mat-option *ngFor="let role of availableRoles" [value]="role.id">
              {{ role.name }}
            </mat-option>
          </mat-select>
        </mat-form-field>

        <div class="checkbox-field">
          <mat-checkbox formControlName="requiresPasswordChange" [checked]="true">
            Require password change on first login
          </mat-checkbox>
        </div>

        <div class="form-actions">
          <button type="button" mat-button (click)="cancel()">Cancel</button>
          <button 
            type="submit" 
            mat-raised-button 
            color="primary" 
            [disabled]="userForm.invalid || loading"
          >
            {{ loading ? 'Creating...' : 'Create User' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .create-user-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      min-height: calc(100vh - 40px);
    }

    .form-field {
      width: 100%;
      margin-bottom: 16px;
    }

    .password-section {
      margin-bottom: 24px;
    }

    .password-field {
      margin-bottom: 12px !important;
    }

    .password-actions {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }

    .password-strength {
      margin-bottom: 16px;
    }

    .strength-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .strength-value {
      font-weight: 500;
    }

    .strength-value.very-weak { color: #d32f2f; }
    .strength-value.weak { color: #f57c00; }
    .strength-value.moderate { color: #fbc02d; }
    .strength-value.strong { color: #689f38; }
    .strength-value.very-strong { color: #388e3c; }

    .mat-progress-bar.very-weak ::ng-deep .mat-progress-bar-fill::after { background-color: #d32f2f; }
    .mat-progress-bar.weak ::ng-deep .mat-progress-bar-fill::after { background-color: #f57c00; }
    .mat-progress-bar.moderate ::ng-deep .mat-progress-bar-fill::after { background-color: #fbc02d; }
    .mat-progress-bar.strong ::ng-deep .mat-progress-bar-fill::after { background-color: #689f38; }
    .mat-progress-bar.very-strong ::ng-deep .mat-progress-bar-fill::after { background-color: #388e3c; }

    .password-requirements h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 500;
    }

    .requirements-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .requirements-list li {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      font-size: 13px;
    }

    .requirement-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 8px;
    }

    .requirements-list li.valid { color: #388e3c; }
    .requirements-list li.invalid { color: #666; }

    .checkbox-field {
      margin-bottom: 16px;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 16px;
      margin-top: 24px;
    }
    
    .permission-error {
      text-align: center;
      padding: 20px;
      background-color: #ffffff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      margin: 20px 0;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
  `]
})
export class CreateUserComponent implements OnInit {
  userForm: FormGroup;
  availableRoles: Role[] = [];
  loading = false;
  hasPermission = false;
  passwordStrength: PasswordStrengthResult | null = null;
  passwordRequirements: string[] = [];
  showRequirements = false;
  generatedPassword: string | null = null;
  hidePassword = true;


  
  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService,
    private roleService: RoleService,
    private permissionService: PermissionService,
    private passwordGeneratorService: PasswordGeneratorService,
    private router: Router,
    private snackBar: MatSnackBar,
    private logger: LoggerService
  ) {
    this.passwordRequirements = this.passwordGeneratorService.getPasswordRequirements();
    
    this.userForm = this.formBuilder.group({
      username: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      firstName: [''],
      lastName: [''],
      password: ['', [
        Validators.required, 
        Validators.minLength(8)
      ]],
      roleId: [null, Validators.required],
      requiresPasswordChange: [true]
    });
  }

  ngOnInit(): void {
    this.logger.info('CreateUserComponent initialized');
    
    // Check if user has permission to create users
    this.permissionService.hasPermission('users:create').subscribe(hasPermission => {
      this.hasPermission = hasPermission;
      
      if (hasPermission) {
        this.loadRoles();
      } else {
        this.snackBar.open('You do not have permission to create users', 'Close', { duration: 5000 });
      }
    });
  }

  loadRoles(): void {
    this.roleService.getRoles().subscribe({
      next: (roles) => {
        this.availableRoles = roles;
        
        // Set default role if available
        if (roles.length > 0) {
          const defaultRole = roles.find(r => r.name === 'User') || roles[0];
          this.userForm.get('roleId')?.setValue(defaultRole.id);
        }
      },
      error: (error) => {
        this.logger.error('Error loading roles', { error });
        this.snackBar.open('Error loading roles', 'Close', { duration: 3000 });
      }
    });
  }

  // Convenience getter for form fields
  get f() { return this.userForm.controls; }

  onPasswordChange(): void {
    const password = this.f['password'].value;
    if (password) {
      this.passwordStrength = this.passwordGeneratorService.validatePassword(password);
      this.showRequirements = true;
    } else {
      this.passwordStrength = null;
      this.showRequirements = false;
    }
  }

  generatePassword(): void {
    this.generatedPassword = this.passwordGeneratorService.generatePassword(12);
    this.f['password'].setValue(this.generatedPassword);
    this.onPasswordChange();
    this.snackBar.open('Password generated!', 'Close', { duration: 5000 });
  }

  togglePasswordVisibility(): void {
    this.hidePassword = !this.hidePassword;
  }

  getStrengthClass(): string {
    if (!this.passwordStrength) return '';
    
    if (this.passwordStrength.score >= 80) return 'very-strong';
    if (this.passwordStrength.score >= 60) return 'strong';
    if (this.passwordStrength.score >= 40) return 'moderate';
    if (this.passwordStrength.score >= 20) return 'weak';
    return 'very-weak';
  }

  getRequirementClass(index: number): string {
    if (!this.passwordStrength) return 'invalid';
    
    const details = this.passwordStrength.details;
    const requirements = [
      details.hasMinLength,
      details.hasUppercase,
      details.hasLowercase,
      details.hasNumbers,
      details.hasSpecialChars,
      details.noRepeatedChars,
      details.noCommonPatterns
    ];
    
    return requirements[index] ? 'valid' : 'invalid';
  }

  getRequirementIcon(index: number): string {
    if (!this.passwordStrength) return 'radio_button_unchecked';
    
    const details = this.passwordStrength.details;
    const requirements = [
      details.hasMinLength,
      details.hasUppercase,
      details.hasLowercase,
      details.hasNumbers,
      details.hasSpecialChars,
      details.noRepeatedChars,
      details.noCommonPatterns
    ];
    
    return requirements[index] ? 'check_circle' : 'radio_button_unchecked';
  }

  onSubmit(): void {
    if (this.userForm.invalid) {
      this.logger.warn('Form is invalid', this.userForm.errors);
      this.snackBar.open('Please fill in all required fields correctly', 'Close', { duration: 5000 });
      return;
    }

    this.loading = true;
    this.logger.info('Creating new user');
    
    const userData = {
      username: this.f['username'].value,
      email: this.f['email'].value,
      firstName: this.f['firstName'].value,
      lastName: this.f['lastName'].value,
      password: this.f['password'].value,
      roleId: this.f['roleId'].value,
      requiresPasswordChange: this.f['requiresPasswordChange'].value
    };

    this.logger.debug('User data prepared', userData);
    
    this.userService.createUser(userData).subscribe({
      next: (createdUser) => {
        this.loading = false;
        this.logger.info('User created successfully', { id: createdUser.id });
        this.snackBar.open('User created successfully', 'Close', { duration: 3000 });
        this.router.navigate(['/app/users']);
      },
      error: (error) => {
        this.loading = false;
        const errorMessage = error?.error?.message || 'Failed to create user';
        this.logger.error('Error creating user', { error });
        this.snackBar.open(errorMessage, 'Close', { duration: 5000 });
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/app/users']);
  }
}