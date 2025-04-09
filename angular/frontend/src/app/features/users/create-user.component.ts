import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { LoggerService } from '../../services/logging/logger.service';
import { RoleService, Role } from '../../services/role.service';
import { PermissionService } from '../../core/services/permission.service';

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
    MatSelectModule
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

        <mat-form-field class="form-field" appearance="outline">
          <mat-label>Password</mat-label>
          <input matInput type="password" formControlName="password" required>
          <mat-error *ngIf="f['password'].hasError('required')">Password is required</mat-error>
          <mat-error *ngIf="f['password'].hasError('minlength')">Password must be at least 8 characters</mat-error>
          <mat-error *ngIf="f['password'].hasError('pattern')">
            Password must contain uppercase, lowercase, number, and special character
          </mat-error>
        </mat-form-field>

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
    }

    .form-field {
      width: 100%;
      margin-bottom: 16px;
    }

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
      background-color: #f5f5f5;
      border-radius: 4px;
      margin: 20px 0;
    }
  `]
})
export class CreateUserComponent implements OnInit {
  userForm: FormGroup;
  availableRoles: Role[] = [];
  loading = false;
  hasPermission = false;

  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService,
    private roleService: RoleService,
    private permissionService: PermissionService,
    private router: Router,
    private snackBar: MatSnackBar,
    private logger: LoggerService
  ) {
    this.userForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: [''],
      lastName: [''],
      password: ['', [
        Validators.required, 
        Validators.minLength(8),
        Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
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

  onSubmit(): void {
    if (this.userForm.invalid) {
      this.logger.warn('Form is invalid', this.userForm.errors);
      return;
    }

    this.loading = true;
    this.logger.info('Creating new user');
    
    const userData = {
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