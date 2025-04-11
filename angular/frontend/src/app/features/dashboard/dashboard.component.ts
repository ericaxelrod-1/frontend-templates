import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { AppConfigService } from '../../core/services/app-config.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    RouterModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  // App configuration properties
  appName = 'Angular Template';
  headerLogo: string | null = null;
  
  constructor(private appConfig: AppConfigService) {}

  ngOnInit() {
    this.appName = this.appConfig.appName;
    this.headerLogo = this.appConfig.headerLogo;
  }
}
