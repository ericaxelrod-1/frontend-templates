import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { AppConfigService } from '../../../core/services';
import { LoggerService } from '../../../services/logging/logger.service';
import { CaptchaService } from '../../../core/services/captcha.service';
import { CaptchaComponent } from '../../../shared/components/captcha/captcha.component';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CaptchaComponent]
})
export class LoginComponent implements OnInit, OnDestroy {
  @ViewChild(CaptchaComponent) captchaComponent!: CaptchaComponent;
  
  loginForm!: FormGroup;
  returnUrl: string = '/';
  private subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);

  loading = false;
  submitted = false;
  error = '';
  
  // App configuration properties
  appName = 'Angular Template';
  landingLogo = 'assets/logos/logo-large.svg';

  loading$!: Observable<boolean>;
  error$!: Observable<string | null>;
  isAuthenticated$!: Observable<boolean>;

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private store: Store,
    private appConfig: AppConfigService,
    private logger: LoggerService,
    private captchaService: CaptchaService
  ) {
    this.logger.info('LoginComponent constructor called');
    try {
      this.appName = this.appConfig.appName;
      this.landingLogo = this.appConfig.landingLogo;
      this.logger.info('LoginComponent config loaded:', { appName: this.appName, landingLogo: this.landingLogo });
    } catch (error) {
      this.logger.error('Error loading app config in LoginComponent constructor:', error);
    }

    // Initialize store selects
    this.loading$ = this.store.select(AuthState.loading);
    this.error$ = this.store.select(AuthState.error);
    this.isAuthenticated$ = this.store.select(AuthState.isAuthenticated);
  }

  ngOnInit(): void {
    this.logger.info('LoginComponent ngOnInit called');
    // Initialize form with validation
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      captcha: [null, Validators.required]
    });

    this.logger.debug('LoginForm initialized:', this.loginForm);

    // Get return URL from route parameters or default to app dashboard
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/app/dashboard';
    this.logger.debug('Return URL set to:', this.returnUrl);

    // Only subscribe to observables in browser environment
    if (isPlatformBrowser(this.platformId)) {
      this.logger.debug('Browser environment detected, subscribing to state changes');
      
      // Subscribe to loading state
      this.subscription.add(
        this.loading$.subscribe(loading => {
          this.logger.debug('Loading state changed:', loading);
          this.loading = loading;
        })
      );

      // Subscribe to error state
      this.subscription.add(
        this.error$.subscribe(error => {
          this.logger.debug('Error state changed:', error);
          this.error = error || '';
        })
      );

      // Subscribe to authentication state
      this.subscription.add(
        this.isAuthenticated$.subscribe(isAuthenticated => {
          this.logger.debug('Authentication state changed:', isAuthenticated);
          if (isAuthenticated) {
            this.router.navigate([this.returnUrl]);
          }
        })
      );
    }
  }

  ngOnDestroy(): void {
    this.logger.info('LoginComponent ngOnDestroy called');
    this.subscription.unsubscribe();
  }

  // Convenience getter for easy access to form fields
  get f() { return this.loginForm.controls; }

  onSubmit(): void {
    this.logger.info('LoginComponent onSubmit called');
    this.submitted = true;
    
    // Mark fields as touched for validation
    this.loginForm.markAllAsTouched();
    if (this.captchaComponent) {
      this.captchaComponent.markAsTouched();
    }

    // Stop here if form is invalid
    if (this.loginForm.invalid) {
      this.logger.warn('Form is invalid');
      
      // Log which controls are invalid and why
      Object.keys(this.loginForm.controls).forEach(key => {
        const control = this.loginForm.get(key);
        if (control?.invalid) {
          this.logger.warn(`Control ${key} is invalid:`, control.errors);
        }
      });
      
      return;
    }

    // Get CAPTCHA data directly from the form value
    const captchaValue = this.f['captcha'].value;
    if (!captchaValue || !captchaValue.captchaId || !captchaValue.userInput) {
      this.logger.warn('CAPTCHA data is missing or invalid:', captchaValue);
      return;
    }

    this.logger.info('Verifying CAPTCHA before login:', captchaValue);
    this.loading = true;

    // Verify CAPTCHA first
    this.captchaService.verifyCaptcha(captchaValue.captchaId, captchaValue.userInput)
      .subscribe({
        next: (response) => {
          this.logger.info('CAPTCHA verification response:', response);
          if (response.success) {
            this.logger.info('CAPTCHA verification successful, proceeding with login');
            this.dispatchLogin();
          } else {
            this.logger.warn('CAPTCHA verification failed');
            this.error = 'CAPTCHA verification failed. Please try again.';
            this.loading = false;
            this.captchaComponent.refreshCaptcha();
          }
        },
        error: (err) => {
          this.logger.error('Error verifying CAPTCHA:', err);
          this.error = 'An error occurred while verifying CAPTCHA. Please try again.';
          this.loading = false;
          this.captchaComponent.refreshCaptcha();
        }
      });
  }

  private dispatchLogin(): void {
    this.logger.info('Dispatching Login action with email:', this.f['email'].value);
    
    // Create a structured data object for better code clarity
    const loginData = {
      email: this.f['email'].value,
      password: this.f['password'].value
    };
    
    // Dispatch login action
    this.store.dispatch(new AuthActions.Login(
      loginData.email,
      loginData.password
    )).subscribe({
      next: () => {
        this.logger.info('Login action dispatched successfully');
      },
      error: (err) => {
        this.logger.error('Error dispatching login action:', err);
        this.captchaComponent.refreshCaptcha();
      }
    });
  }
  
  // Navigate to forgot password page
  navigateToForgotPassword(): void {
    this.logger.debug('NavigateToForgotPassword called');
    this.router.navigate(['/forgot-password']);
  }
  
  // Navigate to register page
  navigateToRegister(): void {
    this.logger.debug('NavigateToRegister called');
    this.router.navigate(['/register']);
  }
} 