import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

interface Feature {
  title: string;
  description: string;
  icon: string;
}

interface TechItem {
  name: string;
  description: string;
}

interface TechCategory {
  category: string;
  technologies: TechItem[];
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule
  ],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent {
  features: Feature[] = [
    {
      title: 'Enterprise RBAC & GBAC',
      description: 'Highly robust Role and Group based access control. Apply any permission set to achieve row-based security (Groups) and object-based security (Roles).',
      icon: 'admin_panel_settings'
    },
    {
      title: 'No-Dependency Auth',
      description: 'Complete, standalone authentication system including login, registration, and session management without relying on external dependencies.',
      icon: 'lock'
    },
    {
      title: 'Granular Event Logging',
      description: 'Comprehensive event logging for all application functions, ensuring you have a complete audit trail for compliance and debugging.',
      icon: 'receipt_long'
    },
    {
      title: 'Built-in Security Suite',
      description: 'Actively prevent attacks and view security risks with a robust, integrated security monitoring suite.',
      icon: 'security'
    },
    {
      title: 'Built-in Admin Suite',
      description: 'Comprehensive administration tools including login audits, security management, and full user control.',
      icon: 'supervisor_account'
    },
    {
      title: 'Agentic Engineering Ready',
      description: 'A platform built from the ground up to support and accelerate AI-driven, agentic software engineering patterns.',
      icon: 'smart_toy'
    },
    {
      title: 'Theme Customization',
      description: 'Easily customize colors, branding, and UI components to match your company identity.',
      icon: 'palette'
    },
    {
      title: 'NGXS State Management',
      description: 'Robust state management with NGXS for predictable state transitions.',
      icon: 'sync_alt'
    }
  ];

  techStack: TechCategory[] = [
    {
      category: 'Frontend',
      technologies: [
        {
          name: 'Angular',
          description: 'Progressive JavaScript framework for building modern web applications'
        },
        {
          name: 'TypeScript',
          description: 'Typed superset of JavaScript that compiles to plain JavaScript'
        },
        {
          name: 'Angular Material',
          description: 'Material Design components for Angular'
        },
        {
          name: 'NGXS',
          description: 'State management pattern + library for Angular'
        }
      ]
    },
    {
      category: 'Backend',
      technologies: [
        {
          name: 'Node.js',
          description: 'JavaScript runtime built on Chrome\'s V8 JavaScript engine'
        },
        {
          name: 'Express',
          description: 'Fast, unopinionated, minimalist web framework for Node.js'
        },
        {
          name: 'MongoDB',
          description: 'NoSQL document database with the scalability and flexibility'
        }
      ]
    }
  ];
}
