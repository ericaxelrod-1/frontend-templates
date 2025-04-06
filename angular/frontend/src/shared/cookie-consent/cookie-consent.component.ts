import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';

export interface CookieConsentDetails {
  consented: boolean;
  date: Date;
  settings: CookieSettings;
}

export interface CookieSettings {
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatIconModule,
    MatDividerModule,
    ReactiveFormsModule
  ],
  templateUrl: './cookie-consent.component.html',
  styleUrls: ['./cookie-consent.component.scss']
})
export class CookieConsentComponent implements OnInit {
  private readonly STORAGE_KEY = 'cookie-consent-settings';
  consentForm: FormGroup;
  isOpen = true;
  showDetails = false;
  private platformId = inject(PLATFORM_ID);

  constructor(private fb: FormBuilder) {
    this.consentForm = this.fb.group({
      necessary: [{ value: true, disabled: true }],
      preferences: [false],
      analytics: [false],
      marketing: [false]
    });
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    // Skip localStorage access during SSR
    if (!this.isBrowser()) {
      return;
    }
    
    // Check if user already made a choice
    const savedConsent = localStorage.getItem(this.STORAGE_KEY);
    if (savedConsent) {
      this.isOpen = false;
      try {
        const parsed = JSON.parse(savedConsent);
        this.consentForm.patchValue(parsed.settings);
      } catch (e) {
        console.error('Failed to parse cookie settings', e);
      }
    }
  }

  acceptAll(): void {
    this.consentForm.patchValue({
      preferences: true,
      analytics: true,
      marketing: true
    });
    this.saveConsent();
  }

  acceptNecessary(): void {
    this.consentForm.patchValue({
      preferences: false,
      analytics: false,
      marketing: false
    });
    this.saveConsent();
  }

  saveConsent(): void {
    const consent: CookieConsentDetails = {
      consented: true,
      date: new Date(),
      settings: {
        necessary: true,
        preferences: this.consentForm.get('preferences')?.value || false,
        analytics: this.consentForm.get('analytics')?.value || false,
        marketing: this.consentForm.get('marketing')?.value || false
      }
    };

    // Skip localStorage access during SSR
    if (this.isBrowser()) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(consent));
    }
    
    // Optional: send to backend if user is authenticated
    // this.sendConsentToBackend(consent);
    this.isOpen = false;
  }

  toggleDetails(): void {
    this.showDetails = !this.showDetails;
  }

  reopenConsent(): void {
    this.isOpen = true;
  }

  // Uncomment and implement if you want to save consent with user account
  /*
  private sendConsentToBackend(consent: CookieConsentDetails): void {
    // If user is authenticated, associate this with their account
    if (this.authService.isAuthenticated) {
      this.http.post('/api/user/cookie-consent', consent).subscribe();
    }
  }
  */
} 