import { Component, OnInit, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule]
})
export class ForgotPasswordComponent implements OnInit, OnDestroy {
  forgotPasswordForm!: FormGroup;
  private subscription: Subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);

  @Select(AuthState.loading) loading$!: Observable<boolean>;
  @Select(AuthState.error) error$!: Observable<string | null>;
  @Select(AuthState.forgotPasswordSuccess) success$!: Observable<boolean>;

  loading = false;
  submitted = false;
  success = false;
  error = '';

  constructor(
    private formBuilder: FormBuilder,
    private store: Store
  ) { }

  ngOnInit(): void {
    // Initialize form with validation
    this.forgotPasswordForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]]
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
  get f() { return this.forgotPasswordForm.controls; }

  onSubmit(): void {
    this.submitted = true;

    // Stop here if form is invalid
    if (this.forgotPasswordForm.invalid) {
      return;
    }

    this.store.dispatch(new AuthActions.ForgotPassword(this.f['email'].value));
  }
} 