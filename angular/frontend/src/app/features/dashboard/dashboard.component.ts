import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { AppConfigService } from '../../core/services';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  // App configuration properties
  appName: string;
  headerLogo: string;
  
  constructor(private appConfig: AppConfigService) {
    this.appName = this.appConfig.appName;
    this.headerLogo = this.appConfig.headerLogo;
  }
}
