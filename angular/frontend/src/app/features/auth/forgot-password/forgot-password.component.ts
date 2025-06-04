import { Component, OnInit, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { AuthService } from '../../../core/services/auth.service';
import { AppConfigService } from '../../../core/services';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    ReactiveFormsModule, 
    RouterModule,
    MatTooltipModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule
  ]
})
export class ForgotPasswordComponent implements OnInit, OnDestroy {
  forgotPasswordForm!: FormGroup;
  private subscription: Subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);
  
  // Flag to track if Material icons are loaded
  isMatIconsLoaded = false;

  @Select(AuthState.loading) loading$!: Observable<boolean>;
  @Select(AuthState.error) error$!: Observable<string | null>;
  @Select(AuthState.forgotPasswordSuccess) success$!: Observable<boolean>;

  loading = false;
  submitted = false;
  success = false;
  error = '';
  
  // App configuration properties
  appName: string;
  landingLogo: string;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private store: Store,
    private authService: AuthService,
    private appConfig: AppConfigService
  ) { 
    this.appName = this.appConfig.appName;
    this.landingLogo = this.appConfig.landingLogo;
  }

  ngOnInit(): void {
    // Initialize form with validation
    this.forgotPasswordForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]]
    });
    
    // Check if Material icons are loaded
    this.checkMaterialIconsLoaded();

    // Only subscribe to observables in browser environment
    if (isPlatformBrowser(this.platformId)) {
      // Subscribe to state changes
      this.subscription.add(
        this.loading$.subscribe(loading => {
          this.loading = loading;
        })
      );

      this.subscription.add(
        this.error$.subscribe(error => {
          this.error = error || '';
        })
      );

      this.subscription.add(
        this.success$.subscribe(success => {
          this.success = success;
        })
      );
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  // Convenience getter for easy access to form fields
  get f() { return this.forgotPasswordForm.controls; }

  onSubmit(): void {
    this.submitted = true;
    
    if (this.forgotPasswordForm.invalid) {
      return;
    }

    this.loading = true;
    this.error = '';
    this.success = false;
    
    const email = this.forgotPasswordForm.get('email')?.value;
    console.log('Component submitting email:', email);
    
    this.authService.forgotPassword(email).subscribe({
      next: (response: any) => {
        console.log('Component received response:', response);
        this.loading = false;
        this.success = true;
        // Form can be reset only if successful
        this.forgotPasswordForm.reset();
        this.submitted = false;
      },
      error: (error: any) => {
        console.error('Component error handling:', error);
        this.loading = false;
        this.error = error?.error?.message || 'An error occurred while processing your request.';
      }
    });
  }

  // Check if Material icons are loaded correctly
  private checkMaterialIconsLoaded(): void {
    if (isPlatformBrowser(this.platformId)) {
      // Simple check to see if Material icons font is loaded
      setTimeout(() => {
        const testIcon = document.querySelector('mat-icon');
        this.isMatIconsLoaded = !!testIcon && window.getComputedStyle(testIcon).fontFamily.includes('Material Icons');
      }, 100); // Small delay to allow icons to load
    }
  }
} 