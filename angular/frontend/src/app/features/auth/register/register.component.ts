import { Component, OnInit, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

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
  registerForm!: FormGroup;
  private subscription: Subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);

  @Select(AuthState.loading) loading$!: Observable<boolean>;
  @Select(AuthState.error) error$!: Observable<string | null>;
  @Select(AuthState.isAuthenticated) isAuthenticated$!: Observable<boolean>;

  loading = false;
  submitted = false;
  error = '';
  passwordVisible = false;
  confirmPasswordVisible = false;
  
  // Password strength calculation
  passwordStrength = 0;
  passwordMessage = '';

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private store: Store
  ) { }

  ngOnInit(): void {
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
      confirmPassword: ['', [Validators.required]]
    }, {
      validators: passwordMatchValidator()
    });

    // Watch password changes to calculate strength in real time
    this.registerForm.get('password')?.valueChanges.subscribe(value => {
      this.calculatePasswordStrength(value);
    });

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
        this.isAuthenticated$.subscribe(isAuthenticated => {
          if (isAuthenticated) {
            this.router.navigate(['/']);
          }
        })
      );
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  // Convenience getter for easy access to form fields
  get f() { return this.registerForm.controls; }
  
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
    this.submitted = true;

    // Stop here if form is invalid
    if (this.registerForm.invalid) {
      return;
    }

    this.store.dispatch(new AuthActions.Register(
      this.f['email'].value,
      this.f['password'].value,
      this.f['firstName'].value,
      this.f['lastName'].value
    ));
  }
} 