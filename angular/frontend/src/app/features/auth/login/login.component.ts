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
import { CaptchaSelectorComponent } from '../../../shared/components/captcha/advanced/captcha-selector.component';
import { AdvancedCaptchaService } from '../../../core/services/advanced-captcha.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CaptchaSelectorComponent]
})
export class LoginComponent implements OnInit, OnDestroy {
  @ViewChild('captchaSelector') captchaSelector!: CaptchaSelectorComponent;
  
  loginForm!: FormGroup;
  returnUrl = '/';
  private subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);

  loading = false;
  submitted = false;
  error = '';
  captchaEnabled = environment.captcha.enabled && !environment.captcha.skipForDevelopment;
  
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
    private captchaService: CaptchaService,
    private advancedCaptchaService: AdvancedCaptchaService
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
    // Initialize form with conditional validation
    const formConfig: any = {
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    };

    // Only add CAPTCHA validation if CAPTCHA is enabled
    if (this.captchaEnabled) {
      formConfig.captcha = [null, Validators.required];
    }

    this.loginForm = this.formBuilder.group(formConfig);

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
    if (this.captchaEnabled && this.captchaSelector) {
      this.captchaSelector.markAsTouched();
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

    // If CAPTCHA is enabled, verify it before proceeding
    if (this.captchaEnabled) {
      // Get CAPTCHA data directly from the selector component
      const captchaData = this.captchaSelector.getCaptchaData();
      if (!captchaData) {
        this.logger.warn('CAPTCHA data is missing');
        return;
      }

      this.logger.info('Verifying CAPTCHA before login:', captchaData);
      this.loading = true;

      // Determine CAPTCHA type and verify with the appropriate service
      const captchaType = this.determineCaptchaType(captchaData);
      
      this.advancedCaptchaService.verifyAdvancedCaptcha(
        captchaData.challengeId, 
        captchaData.selectedAnswer,
        captchaType
      ).subscribe({
        next: (response) => {
          this.logger.info('CAPTCHA verification response:', response);
          if (response.success) {
            this.logger.info('CAPTCHA verification successful, proceeding with login');
            this.dispatchLogin();
          } else {
            this.logger.warn('CAPTCHA verification failed');
            this.error = 'CAPTCHA verification failed. Please try again.';
            this.loading = false;
            // Refresh the captcha
            const activeCaptcha = this.captchaSelector.getActiveCaptchaComponent();
            if (activeCaptcha?.refreshChallenge) {
              activeCaptcha.refreshChallenge();
            }
          }
        },
        error: (err) => {
          this.logger.error('Error verifying CAPTCHA:', err);
          this.error = 'An error occurred while verifying CAPTCHA. Please try again.';
          this.loading = false;
          // Refresh the captcha
          const activeCaptcha = this.captchaSelector.getActiveCaptchaComponent();
          if (activeCaptcha?.refreshChallenge) {
            activeCaptcha.refreshChallenge();
          }
        }
      });
    } else {
      // CAPTCHA is disabled, proceed directly with login
      this.logger.info('CAPTCHA is disabled, proceeding directly with login');
      this.loading = true;
      this.dispatchLogin();
    }
  }

  // Determine the CAPTCHA type based on the captcha data structure
  private determineCaptchaType(captchaData: any): string {
    if (captchaData.challengeId && captchaData.challengeId.startsWith('vr_')) {
      return 'visual-reasoning';
    } else if (captchaData.challengeId && captchaData.challengeId.startsWith('pw_')) {
      return 'physical-world';
    }
    return 'visual-reasoning'; // Default to visual-reasoning captcha
  }

  private dispatchLogin(): void {
    this.logger.info('Dispatching Login action');
    
    // Create a structured data object for better code clarity
    const loginData = {
      email: this.f['email'].value,
      password: this.f['password'].value,
      recaptchaToken: this.captchaEnabled ? 'verified-via-advanced-captcha' : 'captcha-disabled'
    };
    
    this.logger.debug('About to dispatch login action');
    
    // Dispatch login action
    this.store.dispatch(new AuthActions.Login(
      loginData.email,
      loginData.password,
      loginData.recaptchaToken
    )).subscribe({
      next: (result) => {
        this.logger.info('Login action dispatched successfully');
        // Check if the result contains any error information
        if (result.auth && result.auth.error) {
          this.error = result.auth.error;
          this.loading = false;
          
          // Refresh captcha on error if enabled
          if (this.captchaEnabled && this.captchaSelector) {
            const activeCaptcha = this.captchaSelector.getActiveCaptchaComponent();
            if (activeCaptcha?.refreshChallenge) {
              activeCaptcha.refreshChallenge();
            }
          }
        }
      },
      error: (err) => {
        this.logger.error('Error dispatching login action:', err);
        
        // Set a more specific error message based on the error type
        if (err.status === 401) {
          this.error = 'Invalid email or password. Please try again.';
        } else if (err.status === 403) {
          this.error = 'Your account is locked. Please contact an administrator.';
        } else if (err.status === 400) {
          this.error = err.error?.message || 'Invalid login request. Please check your credentials.';
        } else {
          this.error = 'An error occurred during login. Please try again later.';
        }
        
        this.loading = false;
        
        // Refresh captcha on error if enabled
        if (this.captchaEnabled && this.captchaSelector) {
          const activeCaptcha = this.captchaSelector.getActiveCaptchaComponent();
          if (activeCaptcha?.refreshChallenge) {
            activeCaptcha.refreshChallenge();
          }
        }
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