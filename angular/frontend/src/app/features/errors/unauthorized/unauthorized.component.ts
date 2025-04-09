import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-unauthorized',
  templateUrl: './unauthorized.component.html',
  styleUrls: ['./unauthorized.component.scss']
})
export class UnauthorizedComponent implements OnInit {
  isAuthenticated = false;
  returnUrl = '/dashboard';

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.isAuthenticated = !!this.authService.currentUser;
    
    // Get the return URL from query parameters or default to '/dashboard'
    const urlTree = this.router.parseUrl(this.router.url);
    this.returnUrl = urlTree.queryParams['returnUrl'] || '/dashboard';
  }

  goBack(): void {
    this.router.navigateByUrl(this.returnUrl);
  }

  goToLogin(): void {
    this.router.navigate(['/login'], { 
      queryParams: { returnUrl: this.returnUrl } 
    });
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
} 