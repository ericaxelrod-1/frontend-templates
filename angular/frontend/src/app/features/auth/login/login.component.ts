import { Component, OnInit, OnDestroy, inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { AppConfigService } from '../../../core/services';
import { LoggerService } from '../../../services/logging/logger.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule]
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm!: FormGroup;
  returnUrl: string = '/';
  private subscription: Subscription = new Subscription();
  private platformId = inject(PLATFORM_ID);

  @Select(AuthState.loading) loading$!: Observable<boolean>;
  @Select(AuthState.error) error$!: Observable<string | null>;
  @Select(AuthState.isAuthenticated) isAuthenticated$!: Observable<boolean>;

  loading = false;
  submitted = false;
  error = '';
  
  // App configuration properties
  appName = 'Angular Template';
  landingLogo = 'assets/logos/logo-large.svg';

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private store: Store,
    private appConfig: AppConfigService,
    private logger: LoggerService
  ) {
    this.logger.info('LoginComponent constructor called');
    try {
      this.appName = this.appConfig.appName;
      this.landingLogo = this.appConfig.landingLogo;
      this.logger.info('LoginComponent config loaded:', { appName: this.appName, landingLogo: this.landingLogo });
    } catch (error) {
      this.logger.error('Error loading app config in LoginComponent constructor:', error);
    }
  }

  ngOnInit(): void {
    this.logger.info('LoginComponent ngOnInit called');
    // Initialize form with validation
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });

    this.logger.debug('LoginForm initialized:', this.loginForm);

    // Get return URL from route parameters or default to home
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';
    this.logger.debug('Return URL set to:', this.returnUrl);

    // Only subscribe to observables in browser environment
    if (isPlatformBrowser(this.platformId)) {
      this.logger.debug('Browser environment detected, subscribing to state changes');
      // Subscribe to state changes
      this.subscription.add(
        this.loading$.subscribe(loading => {
          this.logger.debug('Loading state changed:', loading);
          this.loading = loading;
        })
      );

      this.subscription.add(
        this.error$.subscribe(error => {
          this.logger.debug('Error state changed:', error);
          this.error = error || '';
        })
      );

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

    // Stop here if form is invalid
    if (this.loginForm.invalid) {
      this.logger.warn('Form is invalid:', this.loginForm.errors);
      return;
    }

    this.logger.info('Dispatching Login action with email:', this.f['email'].value);
    
    this.store.dispatch(new AuthActions.Login(
      this.f['email'].value,
      this.f['password'].value
    ));
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