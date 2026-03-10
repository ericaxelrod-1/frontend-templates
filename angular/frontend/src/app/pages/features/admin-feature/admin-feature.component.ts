import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-admin-feature',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule, RouterModule],
  templateUrl: './admin-feature.component.html',
  styleUrls: ['./admin-feature.component.scss']
})
export class AdminFeatureComponent {
  features = [
    {
      title: 'User Management',
      description: 'Easily manage user accounts, lifecycle, and profile data from a centralized administrative dashboard.',
      icon: 'manage_accounts'
    },
    {
      title: 'Role & Group Control',
      description: 'Create and assign complex role hierarchies and group structures to maintain strict organizational control.',
      icon: 'admin_panel_settings'
    },
    {
      title: 'Login Audits',
      description: 'Monitor every login attempt with detailed metadata, including location, IP address, and device information.',
      icon: 'rule'
    },
    {
      title: 'Security Management',
      description: 'Configure platform-wide security settings, session timeouts, and authentication requirements from one place.',
      icon: 'settings_suggest'
    }
  ];
}
