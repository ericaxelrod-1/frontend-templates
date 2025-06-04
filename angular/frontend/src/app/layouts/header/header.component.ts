import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthActions } from '../../store/auth/auth.state';
import { User } from '../../models';
import { AppConfigService } from '../../core/services';
import { AuthService } from '../../core/services/auth.service';
import { LayoutService, LayoutConfig } from '../../core/services/layout.service';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule
  ]
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() isFixedHeader = false;
  @Output() sidebarToggle = new EventEmitter<void>();
  
  isAuthenticated = false;
  user: User | null = null;
  layoutConfig: LayoutConfig;
  private subscription = new Subscription();
  
  // App configuration properties
  appName: string;
  headerLogo: string;
  
  constructor(
    private authService: AuthService,
    private store: Store,
    private appConfig: AppConfigService,
    private router: Router,
    private layoutService: LayoutService
  ) {
    this.appName = this.appConfig.appName;
    this.headerLogo = this.appConfig.headerLogo;
    this.layoutConfig = this.layoutService.currentConfig;
  }
  
  ngOnInit(): void {
    // Subscribe to auth service's user observable
    this.subscription.add(
      this.authService.currentUser$.subscribe(user => {
        this.user = user;
        this.isAuthenticated = this.authService.isAuthenticated;
      })
    );

    // Subscribe to layout config changes
    this.subscription.add(
      this.layoutService.config$.subscribe(config => {
        this.layoutConfig = config;
      })
    );
  }
  
  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
  
  toggleSidebar(): void {
    this.sidebarToggle.emit();
  }
  
  logout(): void {
    this.store.dispatch(new AuthActions.Logout()).subscribe({
      next: () => {
        this.router.navigate(['/login']);
      },
      error: (error) => {
        console.error('Error during logout:', error);
        this.router.navigate(['/login']);
      }
    });
  }
}
