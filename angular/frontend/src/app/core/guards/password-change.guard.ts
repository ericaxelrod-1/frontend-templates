import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { LoggerService } from '../../services/logging/logger.service';

@Injectable({
  providedIn: 'root'
})
export class PasswordChangeGuard {
  private router = inject(Router);
  private authService = inject(AuthService);
  private logger = inject(LoggerService);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    // Get the current value synchronously to check if user is authenticated
    if (!this.authService.isAuthenticated) {
      this.logger.debug('PasswordChangeGuard: User not authenticated, redirecting to login');
      return this.router.createUrlTree(['/login']);
    }

    return this.authService.currentUser$.pipe(
      take(1),
      map(user => {
        // If no user or user doesn't require password change, allow access
        if (!user || !user.requiresPasswordChange) {
          this.logger.debug('PasswordChangeGuard: No password change required, allowing access');
          return true;
        }
        
        this.logger.info('PasswordChangeGuard: User requires password change, redirecting');
        
        // If user requires password change, redirect to password change page
        // Skip redirection if we're already on the password change page
        if (state.url !== '/app/profile/change-password') {
          return this.router.createUrlTree(['/app/profile/change-password']);
        }
        
        return true;
      })
    );
  }
} 