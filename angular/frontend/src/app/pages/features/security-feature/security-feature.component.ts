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
      title: 'Brute Force Prevention',
      description: 'Native protection against automated credential attacks with dynamic rate limiting and account lockout logic.',
      icon: 'gpp_maybe'
    },
    {
      title: 'Pattern Detection',
      description: 'Advanced algorithms to identify suspicious behavior patterns and potential security risks before they escalate.',
      icon: 'psychology_alt'
    },
    {
      title: 'Security Alerts',
      description: 'Instant notifications for high-priority security events, allowing for rapid response and mitigation.',
      icon: 'notification_important'
    },
    {
      title: 'IP Reputation',
      description: 'Block malicious actors based on IP reputation scoring and geographical risk assessment.',
      icon: 'public_off'
    }
  ];
}
