import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-security-feature',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule, RouterModule],
  templateUrl: './security-feature.component.html',
  styleUrls: ['./security-feature.component.scss']
})
export class SecurityFeatureComponent {
  features = [
    {
      title: 'Unified Risk Scoring',
      description: 'A dynamic risk engine evaluating logins against geolocation data, network reputation, device fingerprints, and user history.',
      icon: 'policy'
    },
    {
      title: 'Behavioral Baselines',
      description: 'Tracks user habits like typical login hours and known devices to immediately identify and block anomalous activity.',
      icon: 'psychology'
    },
    {
      title: 'Offline Geolocation',
      description: 'Privacy-first, blazing fast IP geolocation built directly into the server, requiring no external API dependencies.',
      icon: 'map'
    },
    {
      title: 'Smart Rate Limiting',
      description: 'Lightweight, database-optimized rate limiting designed specifically to stop brute force and credential stuffing attacks instantly.',
      icon: 'speed'
    }
  ];
}
