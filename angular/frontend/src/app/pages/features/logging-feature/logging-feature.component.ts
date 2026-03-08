import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-logging-feature',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule, RouterModule],
  templateUrl: './logging-feature.component.html',
  styleUrls: ['./logging-feature.component.scss']
})
export class LoggingFeatureComponent {
  features = [
    {
      title: 'Full Audit Trail',
      description: 'Record every significant action across the platform. Know exactly who did what, when, and from where.',
      icon: 'history'
    },
    {
      title: 'Real-Time Monitoring',
      description: 'Stream logs in real-time to internal or external monitoring tools for instant visibility into system health.',
      icon: 'insights'
    },
    {
      title: 'Granular Categorization',
      description: 'Filter and search logs by user, resource, severity, or custom tags for lightning-fast troubleshooting.',
      icon: 'filter_alt'
    },
    {
      title: 'Compliance Ready',
      description: 'Documentation and storage patterns designed to meet enterprise compliance standards for data logging.',
      icon: 'fact_check'
    }
  ];
}
