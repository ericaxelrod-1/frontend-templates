import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { LandingHeaderComponent } from './components/landing-header.component';

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
    MatIconModule,
    LandingHeaderComponent
  ],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent {
  features: Feature[] = [
    {
      title: 'Authentication',
      description: 'Complete authentication system with login, registration, password reset, and email verification',
      icon: 'shield'
    },
    {
      title: 'Responsive Design',
      description: 'Fully responsive design that works on all devices and screen sizes',
      icon: 'devices'
    },
    {
      title: 'Theme Customization',
      description: 'Easily customize colors, branding, and UI components to match your company identity',
      icon: 'palette'
    },
    {
      title: 'NGXS State Management',
      description: 'Robust state management with NGXS for predictable state transitions',
      icon: 'sync_alt'
    },
    {
      title: 'Angular Material',
      description: 'Built with Angular Material components for a polished, modern UI',
      icon: 'dashboard'
    },
    {
      title: 'Server-Side Rendering',
      description: 'Optional server-side rendering for improved SEO and performance',
      icon: 'speed'
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
