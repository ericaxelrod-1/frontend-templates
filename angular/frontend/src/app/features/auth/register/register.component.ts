import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ElementRef, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription, of } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AppConfigService } from '../../../core/services';
import { AuthService } from '../../../core/services/auth.service';
import { CaptchaSelectorComponent } from '../../../shared/components/captcha/advanced/captcha-selector.component';
import { CaptchaService } from '../../../core/services/captcha.service';
import { AdvancedCaptchaService } from '../../../core/services/advanced-captcha.service';
import { LoggerService } from '../../../services/logging/logger.service';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthResponse } from '../../../models';

// Custom validator for password strength
export function passwordStrengthValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    
    if (!value) {
      return null;
    }
    
    const hasUpperCase = /[A-Z]+/.test(value);
    const hasLowerCase = /[a-z]+/.test(value);
    const hasNumeric = /[0-9]+/.test(value);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/.test(value);
    
    const passwordValid = hasUpperCase && hasLowerCase && hasNumeric && hasSpecial;
    
    return !passwordValid ? { passwordStrength: true } : null;
  };
}

// Custom validator to check if passwords match
export function passwordMatchValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');
    
    return password && confirmPassword && password.value !== confirmPassword.value 
      ? { passwordMismatch: true } 
      : null;
  };
}

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    ReactiveFormsModule, 
    RouterModule,
    MatTooltipModule,
    MatIconModule,
    MatProgressBarModule,
    CaptchaSelectorComponent
  ]
})
export class RegisterComponent implements OnInit, OnDestroy {
  @ViewChild('captchaSelector') captchaSelector!: CaptchaSelectorComponent;
  
  // Pre-initialize all properties to avoid undefined issues
  registerForm: FormGroup;
  verificationForm: FormGroup;
  
  private subscription: Subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);

  // Initialize observables with safe default values
  loading$ = of(false);
  error$ = of<string | null>(null);
  isAuthenticated$ = of(false);
  registrationSuccess$ = of(false);

  // Initialize variables with default values
  loading = false;
  submitted = false;
  error = '';
  registrationSuccess = false;
  passwordVisible = false;
  confirmPasswordVisible = false;
  
  // Development-only for testing email verification
  testVerificationToken: string | null = null;
  emailSender: string | null = null;
  
  // Verification form variables
  verificationLoading = false;
  verificationSubmitted = false;
  verificationError = '';
  registeredEmail = ''; // Store the email used for registration
  
  // Password strength calculation
  passwordStrength = 0;
  passwordMessage = '';
  
  // App configuration properties
  appName = 'Angular Template';
  landingLogo = 'assets/logos/logo-large.svg';
  
  // Add emailExists property to the class
  emailExists = false;
  
  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private store: Store,
    private appConfig: AppConfigService,
    private authService: AuthService,
    private el: ElementRef,
    private captchaService: CaptchaService,
    private advancedCaptchaService: AdvancedCaptchaService,
    private logger: LoggerService
  ) {
    // Pre-initialize the form to avoid undefined issues
    this.registerForm = this.formBuilder.group({
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [
        Validators.required, 
        Validators.minLength(8),
        passwordStrengthValidator()
      ]],
      confirmPassword: ['', [Validators.required]],
      privacyConsent: [false, [Validators.requiredTrue]],
      captcha: [null, Validators.required]
    }, {
      validators: passwordMatchValidator()
    });
    
    // Initialize verification form
    this.verificationForm = this.formBuilder.group({
      verificationToken: ['', [Validators.required]]
    });
    
    console.log('RegisterComponent constructor called');
    console.log('Component element:', this.el.nativeElement);
    try {
      this.appName = this.appConfig.appName;
      this.landingLogo = this.appConfig.landingLogo;
      console.log('RegisterComponent config loaded:', { appName: this.appName, landingLogo: this.landingLogo });
    } catch (error) {
      console.error('Error loading app config in RegisterComponent constructor:', error);
    }
    
    // Check for persisted registration state
    if (isPlatformBrowser(this.platformId)) {
      this.checkPersistedState();
    }
    
    // Initialize selectors directly in constructor
    if (isPlatformBrowser(this.platformId)) {
      this.loading$ = this.store.select(AuthState.loading);
      this.error$ = this.store.select(AuthState.error);
      this.isAuthenticated$ = this.store.select(AuthState.isAuthenticated);
      this.registrationSuccess$ = this.store.select((state: any) => state.auth.registrationSuccess);
    }
  }

  ngOnInit(): void {
    console.log('RegisterComponent ngOnInit called');
    // Initialize form with validation
    this.registerForm = this.formBuilder.group({
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [
        Validators.required, 
        Validators.minLength(8),
        passwordStrengthValidator()
      ]],
      confirmPassword: ['', [Validators.required]],
      privacyConsent: [false, [Validators.requiredTrue]],
      captcha: [null, Validators.required]
    }, {
      validators: passwordMatchValidator()
    });
    
    // Initialize verification form
    this.verificationForm = this.formBuilder.group({
      verificationToken: ['', [Validators.required]]
    });

    console.log('RegisterForm initialized:', this.registerForm);
    console.log('Is component visible:', this.isElementVisible(this.el.nativeElement));

    // Watch password changes to calculate strength in real time
    this.registerForm.get('password')?.valueChanges.subscribe(value => {
      this.calculatePasswordStrength(value);
    });

    // Only subscribe to observables in browser environment
    if (isPlatformBrowser(this.platformId)) {
      console.log('Browser environment detected, subscribing to state changes');
      
      // Safe subscription to loading state
      this.subscription.add(
        this.loading$.subscribe(loading => {
          console.log('Loading state changed:', loading);
          this.loading = loading;
        })
      );

      // Safe subscription to error state
      this.subscription.add(
        this.error$.subscribe(error => {
          console.log('Error state changed:', error);
          this.error = error || '';
        })
      );

      // Safe subscription to authentication state
      this.subscription.add(
        this.isAuthenticated$.subscribe(isAuthenticated => {
          console.log('Authentication state changed:', isAuthenticated);
          if (isAuthenticated) {
            this.router.navigate(['/']);
          }
        })
      );
      
      // Safe subscription to registration success state
      this.subscription.add(
        this.registrationSuccess$.subscribe(success => {
          console.log('Registration success state changed:', success);
          this.registrationSuccess = success;
          if (success) {
            // Clear form on successful registration
            this.registerForm.reset();
            this.submitted = false;
          }
        })
      );
      
      // Subscribe to test verification token (development-only)
      this.subscription.add(
        this.authService.testVerificationToken$.subscribe(token => {
          console.log('Test verification token updated:', token ? '********' : null);
          this.testVerificationToken = token;
          
          // Try to get debug info from localStorage
          try {
            const debugInfoString = localStorage.getItem('authDebugInfo');
            if (debugInfoString) {
              const debugInfo = JSON.parse(debugInfoString);
              if (debugInfo && debugInfo.emailSender) {
                this.emailSender = debugInfo.emailSender;
              }
            }
          } catch (error) {
            console.error('Error getting debug info:', error);
          }
        })
      );
      
      // Check for persisted registration state
      this.checkPersistedState();
    }
  }

  // Check if element is visible on screen
  private isElementVisible(element: HTMLElement): boolean {
    if (!element || !isPlatformBrowser(this.platformId)) {
      return false;
    }
    
    // Check if getBoundingClientRect is available (browser environment)
    if (typeof element.getBoundingClientRect !== 'function') {
      return false;
    }
    
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    
    // Return true if any part of the element is visible
    return (
      rect.top < windowHeight &&
      rect.left < windowWidth &&
      rect.bottom > 0 &&
      rect.right > 0
    );
  }

  ngOnDestroy(): void {
    console.log('RegisterComponent ngOnDestroy called');
    this.subscription.unsubscribe();
  }

  // Button click handler for debugging visual issues
  onButtonClick(event: MouseEvent): void {
    console.log('Button clicked:', event);
    console.log('Form validity state:', this.registerForm.valid);
  }

  // Convenience getter for easy access to form fields
  get f() { return this.registerForm.controls; }
  
  // Convenience getter for verification form fields
  get v() { return this.verificationForm.controls; }
  
  togglePasswordVisibility() {
    this.passwordVisible = !this.passwordVisible;
  }
  
  toggleConfirmPasswordVisibility() {
    this.confirmPasswordVisible = !this.confirmPasswordVisible;
  }
  
  calculatePasswordStrength(password: string) {
    if (!password) {
      this.passwordStrength = 0;
      this.passwordMessage = '';
      return;
    }
    
    let score = 0;
    
    // Length check
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    
    // Character type checks
    if (/[A-Z]/.test(password)) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    
    // Set normalized strength (0-100)
    this.passwordStrength = Math.min(100, Math.round((score / 6) * 100));
    
    // Set message based on strength
    if (this.passwordStrength < 40) {
      this.passwordMessage = 'Weak password';
    } else if (this.passwordStrength < 70) {
      this.passwordMessage = 'Moderate password';
    } else {
      this.passwordMessage = 'Strong password';
    }
  }

  onSubmit(): void {
    console.log('Form submitted');
    this.submitted = true;
    
    // Stop here if form is invalid
    if (this.registerForm.invalid) {
      console.warn('Form is invalid. Validation errors:');
      Object.keys(this.registerForm.controls).forEach(key => {
        const control = this.registerForm.get(key);
        if (control?.invalid) {
          console.warn(`Control ${key} is invalid:`, control.errors);
        }
      });
      
      // Scroll to the first invalid element
      const firstInvalidElement = this.el.nativeElement.querySelector('.ng-invalid');
      if (firstInvalidElement) {
        console.log('Scrolling to first invalid element:', firstInvalidElement);
        firstInvalidElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      return;
    }
    
    // Get CAPTCHA data directly from the selector component
    const captchaData = this.captchaSelector.getCaptchaData();
    if (!captchaData) {
      console.warn('CAPTCHA data is missing');
      this.error = 'CAPTCHA verification is required. Please complete the CAPTCHA.';
      return;
    }

    console.log('Verifying CAPTCHA before registration');
    this.loading = true;

    // Determine CAPTCHA type and verify with the appropriate service
    const captchaType = this.determineCaptchaType(captchaData);
    
    this.advancedCaptchaService.verifyAdvancedCaptcha(
      captchaData.challengeId, 
      captchaData.selectedAnswer,
      captchaType
    ).subscribe({
      next: (response) => {
        console.log('CAPTCHA verification response:', response);
        if (response.success) {
          console.log('CAPTCHA verification successful, proceeding with registration');
          this.handleRegistration();
        } else {
          console.warn('CAPTCHA verification failed');
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
        console.error('Error verifying CAPTCHA:', err);
        this.error = 'An error occurred while verifying CAPTCHA. Please try again.';
        this.loading = false;
        // Refresh the captcha
        const activeCaptcha = this.captchaSelector.getActiveCaptchaComponent();
        if (activeCaptcha?.refreshChallenge) {
          activeCaptcha.refreshChallenge();
        }
      }
    });
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
  
  private handleRegistration() {
    // Set loading state
    this.loading = true;
    this.logger.info('Submitting registration form');

    // Create registration data object
    const registrationData = {
      email: this.f['email'].value,
      password: this.f['password'].value,
      // Never set requiresPasswordChange for self-registered users
      requiresPasswordChange: false,
      firstName: this.f['firstName']?.value || '',
      lastName: this.f['lastName']?.value || '',
      recaptchaToken: this.f['captcha'].value || 'verified-via-advanced-captcha'
    };

    this.logger.debug('Registration data prepared', registrationData);

    // Submit registration
    this.authService.register(registrationData)
      .subscribe({
        next: (response: AuthResponse) => {
          this.loading = false;
          this.logger.info('Registration successful');
          
          // If verification is required, show verification message
          if (response.requiresVerification) {
            this.router.navigate(['/verify-email'], { 
              queryParams: { 
                email: this.f['email'].value,
                showInstructions: true
              } 
            });
          } else {
            // If no verification required, redirect to login with message
            this.router.navigate(['/login'], { 
              queryParams: { 
                registered: 'true',
                email: this.f['email'].value
              } 
            });
          }
        },
        error: (error: HttpErrorResponse) => {
          this.loading = false;
          this.error = error?.error?.message || 'Registration failed. Please try again.';
          this.logger.error('Registration failed', { error });
          
          // Refresh the captcha
          if (this.captchaSelector?.getActiveCaptchaComponent()?.refreshChallenge) {
            this.captchaSelector.getActiveCaptchaComponent().refreshChallenge();
          }
        }
      });
  }
  
  // Handle manual email verification
  verifyEmail(): void {
    console.log('VerifyEmail called');
    this.verificationSubmitted = true;
    
    // Stop here if form is invalid
    if (this.verificationForm.invalid) {
      console.log('Verification form is invalid');
      return;
    }
    
    const token = this.v['verificationToken'].value;
    console.log('Verifying email with token:', token);
    
    this.verificationLoading = true;
    this.verificationError = '';
    
    this.authService.verifyEmail(token, this.registeredEmail)
      .subscribe({
        next: (response) => {
          console.log('Email verification successful:', response);
          this.verificationLoading = false;
          
          // Update user in state
          this.store.dispatch(new AuthActions.VerifyEmailSuccess(response.user));
          
          // Clear persisted registration state
          this.clearPersistedState();
          
          // Navigate to dashboard/home
          setTimeout(() => {
            this.router.navigate(['/']);
          }, 1000);
        },
        error: (error) => {
          console.error('Email verification failed:', error);
          this.verificationLoading = false;
          this.verificationError = error?.error?.message || 'Verification failed. Please try again.';
        }
      });
  }

  navigateToLogin(): void {
    console.log('NavigateToLogin called');
    // Clear registration state when navigating away
    this.clearPersistedState();
    this.router.navigate(['/login']);
  }

  // Check for persisted registration state
  private checkPersistedState(): void {
    const persistedEmail = localStorage.getItem('registeredEmail');
    const persistedSuccess = localStorage.getItem('registrationSuccess');
    
    if (persistedEmail) {
      this.registeredEmail = persistedEmail;
      console.log('Restored registered email from storage:', this.registeredEmail);
    }
    
    if (persistedSuccess === 'true') {
      this.registrationSuccess = true;
      console.log('Restored registration success state from storage');
    }
  }
  
  // Save registration state to local storage
  private persistRegistrationState(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('registeredEmail', this.registeredEmail);
      localStorage.setItem('registrationSuccess', 'true');
      console.log('Saved registration state to localStorage');
    }
  }
  
  // Clear registration state from local storage
  private clearPersistedState(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('registeredEmail');
      localStorage.removeItem('registrationSuccess');
      console.log('Cleared registration state from localStorage');
    }
  }

  // Copy verification token to clipboard
  copyTokenToClipboard(): void {
    if (!this.testVerificationToken) return;
    
    if (isPlatformBrowser(this.platformId) && navigator.clipboard) {
      navigator.clipboard.writeText(this.testVerificationToken)
        .then(() => {
          console.log('Token copied to clipboard');
          // Could add a visual confirmation here
        })
        .catch(err => {
          console.error('Could not copy text: ', err);
        });
    } else {
      console.error('Clipboard API not available');
    }
  }
}