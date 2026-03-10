import { Component } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

@Component({
  selector: 'app-public-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule
  ],
  templateUrl: './public-header.component.html',
  styleUrls: ['./public-header.component.scss']
})
export class PublicHeaderComponent {
  constructor(private router: Router) { }

  featurePages = [
    { label: 'Access Control (RBAC/GBAC)', route: '/features/rbac', icon: 'admin_panel_settings' },
    { label: 'No-Dependency Auth', route: '/features/auth', icon: 'lock' },
    { label: 'Granular Logging', route: '/features/logging', icon: 'receipt_long' },
    { label: 'Security Suite', route: '/features/security', icon: 'security' },
    { label: 'Admin Suite', route: '/features/admin', icon: 'supervisor_account' }
  ];

  navigateTo(route: string, event?: MouseEvent): void {
    if (event) event.preventDefault();
    this.router.navigate([route]).then(success => {
      if (!success) window.location.href = route;
    }).catch(() => {
      window.location.href = route;
    });
  }

  logoClick(event: MouseEvent): void {
    this.navigateTo('/', event);
  }

  loginClick(event: MouseEvent): void {
    this.navigateTo('/login', event);
  }

  registerClick(event: MouseEvent): void {
    if (event) event.preventDefault();
    window.open('https://github.com/ericaxelrod-1/frontend-templates', '_blank');
  }
}
