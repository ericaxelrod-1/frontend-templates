import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';

interface CookieSettings {
  necessary: boolean; // Always true, can't be toggled
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

interface CookieConsentDetails {
  consented: boolean;
  date: string;
  settings: CookieSettings;
}

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatDividerModule,
    MatSlideToggleModule,
    FormsModule
  ],
  templateUrl: './cookie-consent.component.html',
  styleUrls: ['./cookie-consent.component.scss']
})
export class CookieConsentComponent implements OnInit {
  private readonly COOKIE_CONSENT_KEY = 'cookie-consent-settings';
  isOpen = false;
  cookieSettings: CookieSettings = {
    necessary: true, // Always required
    preferences: true,
    analytics: true,
    marketing: false
  };
  
  constructor(private dialog: MatDialog) {}
  
  ngOnInit(): void {
    // Check if user has already provided consent
    const consent = this.getStoredConsent();
    if (!consent) {
      // If no consent stored, show the consent dialog
      setTimeout(() => {
        this.isOpen = true;
      }, 1000); // Delay to allow page to load
    }
  }
  
  acceptAll(): void {
    const settings: CookieSettings = {
      necessary: true,
      preferences: true,
      analytics: true,
      marketing: true
    };
    this.saveConsent(settings);
    this.isOpen = false;
  }
  
  acceptSelected(): void {
    this.saveConsent(this.cookieSettings);
    this.isOpen = false;
  }
  
  acceptNecessary(): void {
    const settings: CookieSettings = {
      necessary: true,
      preferences: false,
      analytics: false,
      marketing: false
    };
    this.saveConsent(settings);
    this.isOpen = false;
  }
  
  openCookieSettings(): void {
    const storedConsent = this.getStoredConsent();
    if (storedConsent) {
      this.cookieSettings = storedConsent.settings;
    }
    this.isOpen = true;
  }
  
  private saveConsent(settings: CookieSettings): void {
    const consent: CookieConsentDetails = {
      consented: true,
      date: new Date().toISOString(),
      settings
    };
    
    // Save to localStorage
    localStorage.setItem(this.COOKIE_CONSENT_KEY, JSON.stringify(consent));
    
    // Optionally send to backend if you want to store with user
    // this.sendConsentToBackend(consent);
    
    // Apply cookie settings
    this.applyCookieSettings(settings);
  }
  
  private getStoredConsent(): CookieConsentDetails | null {
    const storedConsent = localStorage.getItem(this.COOKIE_CONSENT_KEY);
    if (storedConsent) {
      return JSON.parse(storedConsent);
    }
    return null;
  }
  
  private applyCookieSettings(settings: CookieSettings): void {
    // Implement the logic to enable/disable cookies based on settings
    // This is where you would integrate with your actual cookie/tracking systems
    
    // Example: Google Analytics
    if (settings.analytics) {
      // Enable Google Analytics
      console.log('Analytics cookies enabled');
      // window['ga-disable-GA_MEASUREMENT_ID'] = false;
    } else {
      // Disable Google Analytics
      console.log('Analytics cookies disabled');
      // window['ga-disable-GA_MEASUREMENT_ID'] = true;
    }
    
    // Example: Preference cookies
    if (settings.preferences) {
      console.log('Preference cookies enabled');
      // Enable preference cookies
    } else {
      console.log('Preference cookies disabled');
      // Disable preference cookies
    }
    
    // Example: Marketing cookies
    if (settings.marketing) {
      console.log('Marketing cookies enabled');
      // Enable marketing cookies
    } else {
      console.log('Marketing cookies disabled');
      // Disable marketing cookies
    }
  }
  
  // Optional: Send consent to backend
  /*
  private sendConsentToBackend(consent: CookieConsentDetails): void {
    // If user is authenticated, you can associate this with their account
    if (this.authService.isAuthenticated) {
      this.http.post('/api/user/cookie-consent', consent).subscribe();
    }
  }
  */
} 