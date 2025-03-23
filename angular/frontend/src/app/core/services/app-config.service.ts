import { Injectable } from '@angular/core';
import { appConfig } from '../../../environments/app-config';

@Injectable({
  providedIn: 'root'
})
export class AppConfigService {
  private config = appConfig;

  /**
   * Get the application name
   */
  get appName(): string {
    return this.config.appName;
  }

  /**
   * Get the path to the landing page logo
   */
  get landingLogo(): string {
    return this.config.logos.landingLogo;
  }

  /**
   * Get the path to the header logo
   */
  get headerLogo(): string {
    return this.config.logos.headerLogo;
  }

  /**
   * Get the path to the footer logo
   */
  get footerLogo(): string {
    return this.config.logos.footerLogo;
  }

  /**
   * Get the path to the favicon
   */
  get favicon(): string {
    return this.config.logos.favicon;
  }

  /**
   * Get the primary theme color
   */
  get primaryColor(): string {
    return this.config.theme.primary;
  }

  /**
   * Get the secondary theme color
   */
  get secondaryColor(): string {
    return this.config.theme.secondary;
  }
} 