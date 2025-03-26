import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';

interface FeatureCard {
  title: string;
  description: string;
  icon: string;
}

interface TechStack {
  category: string;
  technologies: {
    name: string;
    description: string;
    icon?: string;
  }[];
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
    MatDividerModule
  ],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent {
  features: FeatureCard[] = [
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
      description: 'Centralized state management using NGXS for predictable application data flow',
      icon: 'data_object'
    },
    {
      title: 'Angular Material',
      description: 'Beautiful, accessible UI components based on Material Design principles',
      icon: 'design_services'
    },
    {
      title: 'Server-Side Rendering',
      description: 'Angular Universal for improved SEO and initial page load performance',
      icon: 'speed'
    }
  ];

  techStack: TechStack[] = [
    {
      category: 'Frontend',
      technologies: [
        {
          name: 'Angular',
          description: 'Latest version with standalone components'
        },
        {
          name: 'TypeScript',
          description: 'For type-safe code and better developer experience'
        },
        {
          name: 'Angular Material',
          description: 'UI component library'
        },
        {
          name: 'NGXS',
          description: 'State management solution'
        }
      ]
    },
    {
      category: 'Backend',
      technologies: [
        {
          name: 'Node.js',
          description: 'JavaScript runtime for the backend'
        },
        {
          name: 'Express',
          description: 'Web framework for Node.js'
        },
        {
          name: 'MongoDB',
          description: 'NoSQL database for flexible data storage'
        },
        {
          name: 'JWT',
          description: 'JSON Web Tokens for secure authentication'
        }
      ]
    },
    {
      category: 'DevOps',
      technologies: [
        {
          name: 'Docker',
          description: 'Containerization for consistent deployments'
        },
        {
          name: 'GitHub Actions',
          description: 'CI/CD pipeline automation'
        }
      ]
    }
  ];
}
