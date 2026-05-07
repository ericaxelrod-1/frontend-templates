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
import { StandardCaptchaComponent } from '../../../shared/components/captcha/standard/standard-captcha.component';
import { environment } from '../../../../environments/environment';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { CustomValidators } from '../../../core/validators/custom-validators';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, StandardCaptchaComponent, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule]
})
export class LoginComponent implements OnInit, OnDestroy {
  @ViewChild('captcha') captcha!: StandardCaptchaComponent;

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
    // Initialize form with conditional validation
    const formConfig: any = {
      email: ['', [Validators.required, CustomValidators.email()]],
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
          if (error && this.captchaEnabled && this.captcha) {
            this.captcha.refreshChallenge();
          }
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

    // Stop here if form is invalid
    if (this.loginForm.invalid) {
      this.logger.warn('Form is invalid');
      return;
    }

    this.dispatchLogin();
  }

  private dispatchLogin(): void {
    this.logger.info('Dispatching Login action');

    let captchaToken = '';
    let captchaSolution = '';

    if (this.captchaEnabled) {
      const captchaData = this.loginForm.get('captcha')?.value;
      if (captchaData) {
        captchaToken = captchaData.captchaToken;
        captchaSolution = captchaData.captchaSolution;
      }
    }

    // Dispatch login action - NgRx actions don't return results, they update state
    this.store.dispatch(new AuthActions.Login(
      this.f['email'].value,
      this.f['password'].value,
      'verified-via-captcha',
      captchaToken,
      captchaSolution
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
