import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppConfigService } from '../../core/services/app-config.service';
import { PageTitleService } from '../../core/services/page-title.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    RouterModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  // App configuration properties
  appName = 'Angular Template';
  headerLogo: string | null = null;

  constructor(
    private appConfig: AppConfigService,
    private router: Router,
    private pageTitleService: PageTitleService
  ) { }

  ngOnInit(): void {
    this.pageTitleService.setTitle('Dashboard');
    this.appName = this.appConfig.appName;
    this.headerLogo = this.appConfig.headerLogo;
  }

  /**
   * Navigate to Users management page
   */
  navigateToUsers(): void {
    this.router.navigate(['/app/users']);
  }

  /**
   * Navigate to Groups management page
   */
  navigateToGroups(): void {
    this.router.navigate(['/app/groups']);
  }

  /**
   * Navigate to Activity monitoring page
   */
  navigateToActivity(): void {
    this.router.navigate(['/admin/login-monitoring']);
  }
}
