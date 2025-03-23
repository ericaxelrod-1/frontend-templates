import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ElementRef } from '@angular/core';
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
    MatProgressBarModule
  ]
})
export class RegisterComponent implements OnInit, OnDestroy {
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
  
  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private store: Store,
    private appConfig: AppConfigService,
    private authService: AuthService,
    private el: ElementRef
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
      privacyConsent: [false, [Validators.requiredTrue]]
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
      privacyConsent: [false, [Validators.requiredTrue]]
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
    }
  }

  // Helper method to check visibility
  private isElementVisible(element: HTMLElement): boolean {
    if (!element) return false;
    
    // Check if we're in a browser environment before accessing window
    if (isPlatformBrowser(this.platformId)) {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && 
             style.visibility !== 'hidden' && 
             style.opacity !== '0' &&
             element.offsetWidth > 0 && 
             element.offsetHeight > 0;
    }
    
    // Default to true in non-browser environments
    return true;
  }

  ngOnDestroy(): void {
    console.log('RegisterComponent ngOnDestroy called');
    this.subscription.unsubscribe();
  }

  // Add a direct button click handler for debugging
  onButtonClick(event: MouseEvent): void {
    console.log('Register button clicked directly');
    // Don't prevent default behavior, let the form submission happen
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
    
    let strength = 0;
    
    // Length check
    if (password.length >= 8) strength += 25;
    
    // Character variety checks
    if (/[A-Z]+/.test(password)) strength += 25;
    if (/[a-z]+/.test(password)) strength += 25;
    if (/[0-9]+/.test(password)) strength += 12.5;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/.test(password)) strength += 12.5;
    
    this.passwordStrength = strength;
    
    // Set appropriate message
    if (strength < 50) {
      this.passwordMessage = 'Weak';
    } else if (strength < 75) {
      this.passwordMessage = 'Medium';
    } else if (strength < 100) {
      this.passwordMessage = 'Strong';
    } else {
      this.passwordMessage = 'Very Strong';
    }
  }

  onSubmit(): void {
    console.log('RegisterComponent onSubmit called');
    this.submitted = true;

    // Dump form values and validation state for debugging
    console.log('Form values:', this.registerForm.value);
    console.log('Form valid:', this.registerForm.valid);
    console.log('Form validation errors:', this.registerForm.errors);
    
    // Stop here if form is invalid
    if (this.registerForm.invalid) {
      console.log('Form is invalid, preventing submission');
      
      // Find all invalid controls and log their issues
      Object.keys(this.f).forEach(key => {
        const control = this.f[key];
        if (control.invalid) {
          console.error(`Control ${key} is invalid:`, control.errors);
        }
      });
      
      // Mark all fields as touched to show validation errors
      this.registerForm.markAllAsTouched();
      
      // Scroll to the first invalid element if in browser environment
      if (isPlatformBrowser(this.platformId)) {
        setTimeout(() => {
          const invalidElement = this.el.nativeElement.querySelector('.ng-invalid');
          if (invalidElement) {
            invalidElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            invalidElement.focus();
          }
        });
      }
      
      return;
    }

    console.log('Form is valid, proceeding with registration');
    
    // Create the registration data
    const registrationData = {
      email: this.f['email'].value,
      password: this.f['password'].value,
      firstName: this.f['firstName'].value,
      lastName: this.f['lastName'].value,
      privacyConsent: this.f['privacyConsent'].value
    };
    
    // Store the email for verification purposes
    this.registeredEmail = registrationData.email;
    
    console.log('Dispatching Register action with data:', {
      ...registrationData,
      password: '******' // Don't log actual password
    });
    
    try {
      // Ensure we're properly subscribing to the dispatch result
      this.store.dispatch(new AuthActions.Register(
        registrationData.email,
        registrationData.password,
        registrationData.firstName,
        registrationData.lastName,
        registrationData.privacyConsent
      )).subscribe({
        next: (result) => {
          console.log('Register action completed successfully with state:', result);
          // Save registration state for persistence
          this.persistRegistrationState();
        },
        error: (error) => {
          console.error('Error occurred during registration:', error);
          this.error = error?.message || 'Registration failed. Please try again.';
        }
      });
      
      console.log('Register action dispatched successfully');
    } catch (error) {
      console.error('Error dispatching Register action:', error);
      this.error = 'An unexpected error occurred. Please try again.';
    }
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
} 