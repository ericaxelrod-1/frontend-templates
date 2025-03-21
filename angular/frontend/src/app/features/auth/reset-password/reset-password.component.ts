import { Component, OnInit, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule, isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule]
})
export class ResetPasswordComponent implements OnInit, OnDestroy {
  resetPasswordForm!: FormGroup;
  token: string = '';
  private subscription: Subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);

  @Select(AuthState.loading) loading$!: Observable<boolean>;
  @Select(AuthState.error) error$!: Observable<string | null>;
  @Select(AuthState.passwordResetSuccess) success$!: Observable<boolean>;

  loading = false;
  submitted = false;
  success = false;
  error = '';

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private store: Store
  ) { }

  ngOnInit(): void {
    // Get token from query params
    this.token = this.route.snapshot.queryParams['token'] || '';
    
    if (!this.token) {
      this.error = 'Invalid password reset link. Please request a new one.';
      return;
    }
    
    // Initialize form with validation
    this.resetPasswordForm = this.formBuilder.group({
      password: ['', [Validators.required, Validators.minLength(8)]],
      passwordConfirmation: ['', Validators.required]
    }, {
      validator: this.passwordMatchValidator
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
  get f() { return this.resetPasswordForm.controls; }

  // Custom validator to check if passwords match
  passwordMatchValidator(g: FormGroup) {
    const password = g.get('password')?.value;
    const confirmPassword = g.get('passwordConfirmation')?.value;
    
    return password === confirmPassword ? null : { mismatch: true };
  }

  onSubmit(): void {
    this.submitted = true;

    // Stop here if form is invalid
    if (this.resetPasswordForm.invalid) {
      return;
    }

    this.store.dispatch(new AuthActions.ResetPassword(
      this.token,
      this.f['password'].value,
      this.f['passwordConfirmation'].value
    ));
  }
} 