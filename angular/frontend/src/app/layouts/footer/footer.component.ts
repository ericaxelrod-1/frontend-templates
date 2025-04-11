import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router } from '@angular/router';
import { AppConfigService } from '../../core/services';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule
  ],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss'
})
export class FooterComponent {
  @Input() isAuthPage = false;
  currentYear = new Date().getFullYear();
  
  // App configuration properties
  appName: string;
  footerLogo: string;
  
  constructor(
    private router: Router,
    private appConfig: AppConfigService
  ) {
    this.appName = this.appConfig.appName;
    this.footerLogo = this.appConfig.footerLogo;
  }
}
