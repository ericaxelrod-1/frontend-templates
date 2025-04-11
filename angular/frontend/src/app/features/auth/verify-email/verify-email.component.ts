import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import { AppConfigService } from '../../../core/services/app-config.service';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { AuthActions } from '../../../store/auth/auth.state';
import { VerificationResponse } from '../../../models';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.scss'
})
export class VerifyEmailComponent implements OnInit {
  // App configuration properties
  appName: string;
  landingLogo: string;
  
  isVerifying = true;
  isSuccess = false;
  isError = false;
  errorMessage = '';
  
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private appConfig: AppConfigService,
    private store: Store
  ) { 
    this.appName = this.appConfig.appName;
    this.landingLogo = this.appConfig.landingLogo;
  }

  ngOnInit() {
    // Get token from the URL
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      const email = params['email'];
      if (token && email) {
        this.verifyEmail(token, email);
      } else if (token) {
        this.showError('Email address is missing. Verification requires both token and email.');
      } else {
        this.showError('Verification link is invalid. No token provided.');
      }
    });
  }

  private verifyEmail(token: string, email: string): void {
    console.log('verifyEmail called with token:', token, 'and email:', email);
    this.isVerifying = true;
    this.isSuccess = false;
    this.isError = false;
    this.errorMessage = '';
    
    this.authService.verifyEmail(token, email)
      .subscribe({
        next: (response: VerificationResponse) => {
          console.log('Email verification successful:', response);
          this.isVerifying = false;
          this.isSuccess = true;
          this.store.dispatch(new AuthActions.VerifyEmailSuccess(response.user));
        },
        error: (error: HttpErrorResponse) => {
          console.error('Email verification failed:', error);
          this.isVerifying = false;
          this.isError = true;
          this.errorMessage = error?.error?.message || 'Email verification failed. Please try again or contact support.';
        }
      });
  }

  private showError(message: string) {
    this.isVerifying = false;
    this.isSuccess = false;
    this.isError = true;
    this.errorMessage = message;
  }

  navigateToLogin() {
    this.router.navigate(['/auth/login']);
  }
} 