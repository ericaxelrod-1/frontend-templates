import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-auth-feature',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule, RouterModule],
  templateUrl: './auth-feature.component.html',
  styleUrls: ['./auth-feature.component.scss']
})
export class AuthFeatureComponent {
  features = [
    {
      title: 'Zero Dependencies',
      description: 'Our authentication system is built natively without relying on heavy third-party providers. Total control over your user data.',
      icon: 'sync_disabled'
    },
    {
      title: 'Secure Registration',
      description: 'Built-in email verification and validation logic to ensure high-quality user signups from day one.',
      icon: 'app_registration'
    },
    {
      title: 'Session Management',
      description: 'Highly secure JWT-based session management with automatic refresh logic and broad browser compatibility.',
      icon: 'key'
    },
    {
      title: 'Password Privacy',
      description: 'Enterprise-grade password hashing and recovery workflows built directly into the core platform.',
      icon: 'password'
    }
  ];
}
