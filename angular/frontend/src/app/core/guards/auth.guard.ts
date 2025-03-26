import { Injectable } from '@angular/core';
import { 
  CanActivate, 
  ActivatedRouteSnapshot, 
  RouterStateSnapshot, 
  Router, 
  UrlTree 
} from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { Store } from '@ngxs/store';
import { AuthState } from '../../store/auth/auth.state';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router,
    private store: Store
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    
    // Get authentication state from store
    return this.store.select(AuthState.isAuthenticated).pipe(
      switchMap(isAuthenticated => {
        if (isAuthenticated && this.authService.isAuthenticated) {
          return of(true);
        }
        
        // If not authenticated, redirect to login
        return of(this.router.createUrlTree(['/login'], { 
          queryParams: { returnUrl: state.url } 
        }));
      })
    );
  }
} 