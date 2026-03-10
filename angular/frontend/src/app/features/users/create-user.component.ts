import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserService } from '../../services/user.service';
import { RoleService, Role } from '../../services/role.service';
import { GroupService } from '../../services/group.service';
import { Group } from '../../models/group.model';
import { PermissionService } from '../../core/services/permission.service';
import { PasswordGeneratorService, PasswordStrengthResult } from '../../core/services/password-generator.service';
import { LoggerService } from '../../services/logging/logger.service';
import { RoleSelectorSidebarComponent } from './role-selector-sidebar/role-selector-sidebar.component';
import { GroupSelectorSidebarComponent } from './group-selector-sidebar/group-selector-sidebar.component';
import { SidePanelService } from '../../shared/components/side-panel';
import { PageTitleService } from '../../core/services/page-title.service';

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
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatChipsModule
  ],
  template: `
    <div class="create-user-container">
      <div class="form-container">
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

          <!-- Roles Selection -->
          <div class="selection-field">
            <label class="selection-label">Roles</label>
            <div class="selection-content">
              <div class="selected-items" *ngIf="selectedRoleIds.length > 0">
                <mat-chip-set>
                  <mat-chip *ngFor="let roleId of selectedRoleIds" [removable]="true" (removed)="removeRole(roleId)">
                    {{ getRoleName(roleId) }}
                    <mat-icon matChipRemove>cancel</mat-icon>
                  </mat-chip>
                </mat-chip-set>
              </div>
              <div class="no-selection" *ngIf="selectedRoleIds.length === 0">
                <span class="placeholder-text">No roles selected</span>
              </div>
              <button 
                type="button" 
                mat-raised-button 
                color="primary" 
                (click)="openRoleSelector()"
                class="selector-button"
              >
                <mat-icon>person_add</mat-icon>
                Select Roles
              </button>
            </div>
            <div class="selection-hint">Select one or more roles for the user</div>
          </div>

          <!-- Groups Selection -->
          <div class="selection-field">
            <label class="selection-label">Groups</label>
            <div class="selection-content">
              <div class="selected-items" *ngIf="selectedGroupIds.length > 0">
                <mat-chip-set>
                  <mat-chip *ngFor="let groupId of selectedGroupIds" [removable]="true" (removed)="removeGroup(groupId)">
                    {{ getGroupName(groupId) }}
                    <mat-icon matChipRemove>cancel</mat-icon>
                  </mat-chip>
                </mat-chip-set>
              </div>
              <div class="no-selection" *ngIf="selectedGroupIds.length === 0">
                <span class="placeholder-text">No groups selected</span>
              </div>
              <button 
                type="button" 
                mat-raised-button 
                color="accent" 
                (click)="openGroupSelector()"
                class="selector-button"
              >
                <mat-icon>group_add</mat-icon>
                Select Groups
              </button>
            </div>
            <div class="selection-hint">Select groups to add the user to (optional)</div>
          </div>

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
              [disabled]="userForm.invalid || loading || selectedRoleIds.length === 0"
            >
              {{ loading ? 'Creating...' : 'Create User' }}
            </button>
          </div>
        </form>
      </div>
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

    .selection-field {
      margin-bottom: 24px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 16px;
      background-color: #fafafa;
    }

    .selection-label {
      display: block;
      font-weight: 500;
      color: #333;
      margin-bottom: 12px;
      font-size: 14px;
    }

    .selection-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .selected-items mat-chip-set {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .selected-items mat-chip {
      background-color: #e3f2fd;
      color: #1976d2;
    }

    .no-selection {
      padding: 8px 0;
    }

    .placeholder-text {
      color: #666;
      font-style: italic;
    }

    .selector-button {
      align-self: flex-start;
      min-width: 140px;
    }

    .selection-hint {
      font-size: 12px;
      color: #666;
      margin-top: 8px;
    }

    .password-section {
      margin-bottom: 24px;
    }

    .password-field {
      position: relative;
    }

    .password-actions {
      margin-top: 8px;
      margin-bottom: 16px;
    }

    .password-strength {
      margin-bottom: 16px;
    }

    .strength-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .strength-label {
      font-size: 14px;
      color: #666;
    }

    .strength-value {
      font-weight: 500;
      font-size: 14px;
    }

    .strength-value.weak {
      color: #f44336;
    }

    .strength-value.fair {
      color: #ff9800;
    }

    .strength-value.good {
      color: #2196f3;
    }

    .strength-value.strong {
      color: #4caf50;
    }

    .password-requirements {
      background-color: #f5f5f5;
      padding: 16px;
      border-radius: 4px;
      border-left: 4px solid #2196f3;
    }

    .password-requirements h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      color: #333;
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
      margin-right: 8px;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .requirements-list li.met {
      color: #4caf50;
    }

    .requirements-list li.unmet {
      color: #666;
    }

    .checkbox-field {
      margin-bottom: 24px;
    }

    .form-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }

    .permission-error {
      text-align: center;
      padding: 40px;
      background-color: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      color: #856404;
    }

    @media (max-width: 768px) {
      .create-user-container {
        margin: 0;
        padding: 16px;
        border-radius: 0;
        min-height: 100vh;
      }

      .form-actions {
        flex-direction: column;
      }

      .form-actions button {
        width: 100%;
      }
    }
  `]
})
export class CreateUserComponent implements OnInit {
  userForm: FormGroup;
  availableRoles: Role[] = [];
  availableGroups: Group[] = [];
  selectedRoleIds: number[] = [];
  selectedGroupIds: number[] = [];
  loading = false;
  hasPermission = false;
  passwordStrength: PasswordStrengthResult | null = null;
  passwordRequirements: string[] = [];
  showRequirements = false;
  generatedPassword: string | null = null;
  hidePassword = true;

  private snackBar = inject(MatSnackBar);

  get f() { return this.userForm.controls; }

  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService,
    private roleService: RoleService,
    private groupService: GroupService,
    private permissionService: PermissionService,
    private passwordGeneratorService: PasswordGeneratorService,
    private router: Router,
    private logger: LoggerService,
    private sidePanelService: SidePanelService,
    private pageTitleService: PageTitleService
  ) {
    this.userForm = this.formBuilder.group({
      username: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      firstName: [''],
      lastName: [''],
      password: ['', [Validators.required, Validators.minLength(8)]],
      requiresPasswordChange: [true]
    });

    this.passwordRequirements = this.passwordGeneratorService.getPasswordRequirements();
    this.showRequirements = true;
  }

  ngOnInit(): void {
    this.pageTitleService.setTitle('Create User');
    this.checkPermissions();
    this.loadRoles();
    this.loadGroups();
  }

  checkPermissions(): void {
    this.permissionService.hasPermission('users:create').subscribe(hasPermission => {
      this.hasPermission = hasPermission;
    });
  }

  loadRoles(): void {
    this.roleService.getRoles().subscribe({
      next: (response) => {
        this.availableRoles = response.items;
        this.logger.info('CreateUserComponent', 'Roles loaded successfully', { count: response.items.length });
      },
      error: (error) => {
        this.logger.error('CreateUserComponent', 'Error loading roles', error);
        this.snackBar.open('Error loading roles', 'Close', { duration: 3000 });
      }
    });
  }

  loadGroups(): void {
    this.groupService.getGroups().subscribe({
      next: (response) => {
        this.availableGroups = response.items;
        this.logger.info('CreateUserComponent', 'Groups loaded successfully', { count: response.items.length });
      },
      error: (error) => {
        this.logger.error('CreateUserComponent', 'Error loading groups', error);
        this.snackBar.open('Error loading groups', 'Close', { duration: 3000 });
      }
    });
  }

  // Role selection methods
  openRoleSelector(): void {
    const ref = this.sidePanelService.open(RoleSelectorSidebarComponent, {
      data: { selectedRoleIds: [...this.selectedRoleIds] },
      width: '400px'
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.selectedRoleIds = result;
      }
    });
  }

  removeRole(roleId: number): void {
    this.selectedRoleIds = this.selectedRoleIds.filter(id => id !== roleId);
  }

  getRoleName(roleId: number): string {
    const role = this.availableRoles.find(r => r.id === roleId);
    return role ? role.name : `Role ${roleId}`;
  }

  // Group selection methods
  openGroupSelector(): void {
    const ref = this.sidePanelService.open(GroupSelectorSidebarComponent, {
      data: { selectedGroupIds: [...this.selectedGroupIds] },
      width: '400px'
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.selectedGroupIds = result;
      }
    });
  }

  removeGroup(groupId: number): void {
    this.selectedGroupIds = this.selectedGroupIds.filter(id => id !== groupId);
  }

  getGroupName(groupId: number): string {
    const group = this.availableGroups.find(g => g.id === groupId);
    return group ? group.name : `Group ${groupId}`;
  }

  onPasswordChange(): void {
    const password = this.userForm.get('password')?.value;
    if (password) {
      this.passwordStrength = this.passwordGeneratorService.validatePassword(password);
    } else {
      this.passwordStrength = null;
    }
  }

  generatePassword(): void {
    this.generatedPassword = this.passwordGeneratorService.generatePassword();
    this.userForm.patchValue({ password: this.generatedPassword });
    this.onPasswordChange();
  }

  togglePasswordVisibility(): void {
    this.hidePassword = !this.hidePassword;
  }

  getStrengthClass(): string {
    if (!this.passwordStrength) return '';

    if (this.passwordStrength.score >= 80) return 'strong';
    if (this.passwordStrength.score >= 60) return 'good';
    if (this.passwordStrength.score >= 40) return 'fair';
    return 'weak';
  }

  getRequirementClass(index: number): string {
    if (!this.passwordStrength) return 'unmet';

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

    return requirements[index] ? 'met' : 'unmet';
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
    if (this.userForm.valid && this.selectedRoleIds.length > 0) {
      this.loading = true;

      const userData = {
        ...this.userForm.value,
        roleIds: this.selectedRoleIds,
        groupIds: this.selectedGroupIds
      };

      this.userService.createUser(userData).subscribe({
        next: (response) => {
          this.logger.info('CreateUserComponent', 'User created successfully', { userId: response.id });
          this.snackBar.open('User created successfully', 'Close', { duration: 3000 });
          this.router.navigate(['/users']);
        },
        error: (error) => {
          this.loading = false;
          this.logger.error('CreateUserComponent', 'Error creating user', error);
          this.snackBar.open('Error creating user: ' + (error.error?.message || 'Unknown error'), 'Close', { duration: 5000 });
        }
      });
    }
  }

  cancel(): void {
    this.router.navigate(['/users']);
  }
}