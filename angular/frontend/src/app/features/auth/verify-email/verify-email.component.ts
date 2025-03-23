import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../auth.service';
import { AppConfigService } from '../../../core/services/app-config.service';

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
    private appConfig: AppConfigService
  ) { 
    this.appName = this.appConfig.appName;
    this.landingLogo = this.appConfig.landingLogo;
  }

  ngOnInit() {
    // Get token from the URL
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      if (token) {
        this.verifyEmail(token);
      } else {
        this.showError('Verification link is invalid. No token provided.');
      }
    });
  }

  private verifyEmail(token: string) {
    this.isVerifying = true;
    this.isSuccess = false;
    this.isError = false;
    
    this.authService.verifyEmail(token)
      .pipe(
        finalize(() => {
          this.isVerifying = false;
        })
      )
      .subscribe({
        next: () => {
          this.isSuccess = true;
        },
        error: (error) => {
          this.showError(error.error?.message || 'Email verification failed. Please try again or contact support.');
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