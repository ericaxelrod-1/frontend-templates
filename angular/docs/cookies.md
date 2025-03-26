# Cookie Management Guide

This document explains how the cookie consent system works in our Angular template and provides instructions on how to implement optional cookies for different categories.

## Cookie Categories

Our application categorizes cookies into four main types:

1. **Necessary Cookies**: Essential for the website to function properly
2. **Preference Cookies**: Allow the website to remember preferences and settings
3. **Analytics Cookies**: Track user behavior to improve site functionality
4. **Marketing Cookies**: Used for targeted advertising and marketing efforts

## Cookie Consent Implementation

The application includes a comprehensive cookie consent system that allows users to control which types of cookies they accept. This consent system is implemented through the `CookieConsentComponent`.

### Cookie Consent Storage

The user's cookie preferences are stored in two ways:

1. **Local Storage**: All cookie preferences are stored in the browser's local storage
2. **User Account (Optional)**: Cookie preferences can be associated with a user account

### User Database Storage (Optional)

To save cookie consent in the user database, modify the `cookie-consent.component.ts` file:

```typescript
// Uncomment and configure this method in cookie-consent.component.ts
private sendConsentToBackend(consent: CookieConsentDetails): void {
  // If user is authenticated, associate this with their account
  if (this.authService.isAuthenticated) {
    this.http.post('/api/user/cookie-consent', consent).subscribe();
  }
}
```

Then update your User model in the database to include cookie consent preferences:

```typescript
// Add to your User model
cookieConsent: {
  consented: boolean;
  date: Date;
  settings: {
    necessary: boolean;
    preferences: boolean;
    analytics: boolean;
    marketing: boolean;
  }
}
```

## Implementing Cookie Types

### 1. Necessary Cookies

These cookies are always enabled and cannot be rejected by users:

```typescript
// Example of setting a necessary cookie
document.cookie = "session_id=abc123; path=/; max-age=86400; Secure; SameSite=Strict";
```

Necessary cookies typically include:
- Session cookies
- Authentication cookies
- Security-related cookies
- Load balancing cookies

### 2. Preference Cookies

These cookies store user preferences and settings:

```typescript
// Only set preference cookies if consent is given
const consent = JSON.parse(localStorage.getItem('cookie-consent-settings') || '{}');
if (consent?.settings?.preferences) {
  // Set theme preference cookie
  document.cookie = "theme=dark; path=/; max-age=31536000; SameSite=Lax";
  
  // Set language preference cookie
  document.cookie = "language=en; path=/; max-age=31536000; SameSite=Lax";
}
```

Typical preference cookies include:
- Theme selection
- Language preferences
- Interface customizations
- Recent searches
- Recently viewed items

### 3. Analytics Cookies

These cookies track how users interact with the website:

```typescript
// Example for Google Analytics
const consent = JSON.parse(localStorage.getItem('cookie-consent-settings') || '{}');
if (consent?.settings?.analytics) {
  // Initialize Google Analytics
  // Replace 'G-XXXXXXXXXX' with your actual tracking ID
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX`;
  document.head.appendChild(script);
  
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
} else {
  // Disable Google Analytics
  window['ga-disable-G-XXXXXXXXXX'] = true;
}
```

Analytics cookies often include:
- Google Analytics cookies
- Hotjar tracking cookies
- Click tracking
- Page view tracking
- Session duration tracking

### 4. Marketing Cookies

These cookies are used for advertising and marketing purposes:

```typescript
// Example for Facebook Pixel
const consent = JSON.parse(localStorage.getItem('cookie-consent-settings') || '{}');
if (consent?.settings?.marketing) {
  // Initialize Facebook Pixel
  // Replace 'XXXXXXXXXXXXXXX' with your actual Pixel ID
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'XXXXXXXXXXXXXXX');
  fbq('track', 'PageView');
}
```

Marketing cookies include:
- Facebook Pixel
- Google Ads conversion tracking
- Retargeting cookies
- Affiliate tracking cookies
- Social media sharing cookies

## Service Implementation

To manage cookies consistently across the application, create a dedicated cookie service:

```typescript
// src/app/core/services/cookie.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface CookieSettings {
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CookieService {
  private readonly COOKIE_CONSENT_KEY = 'cookie-consent-settings';
  private cookieSettingsSubject = new BehaviorSubject<CookieSettings>({
    necessary: true,
    preferences: false,
    analytics: false,
    marketing: false
  });
  
  cookieSettings$ = this.cookieSettingsSubject.asObservable();
  
  constructor() {
    this.loadSettings();
  }
  
  private loadSettings(): void {
    const storedSettings = localStorage.getItem(this.COOKIE_CONSENT_KEY);
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        this.cookieSettingsSubject.next(parsed.settings);
      } catch (e) {
        console.error('Failed to parse cookie settings', e);
      }
    }
  }
  
  getSettings(): CookieSettings {
    return this.cookieSettingsSubject.value;
  }
  
  isCategoryAccepted(category: keyof CookieSettings): boolean {
    return this.cookieSettingsSubject.value[category];
  }
  
  setCookie(name: string, value: string, days: number, category: keyof CookieSettings): boolean {
    // Always set necessary cookies
    if (category === 'necessary') {
      this.setRawCookie(name, value, days);
      return true;
    }
    
    // Only set other cookies if the category is accepted
    if (this.isCategoryAccepted(category)) {
      this.setRawCookie(name, value, days);
      return true;
    }
    
    return false;
  }
  
  private setRawCookie(name: string, value: string, days: number): void {
    let expires = '';
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
  }
  
  getCookie(name: string): string | null {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') {
        c = c.substring(1, c.length);
      }
      if (c.indexOf(nameEQ) === 0) {
        return decodeURIComponent(c.substring(nameEQ.length, c.length));
      }
    }
    return null;
  }
  
  deleteCookie(name: string): void {
    document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
  }
}
```

## Best Practices

1. **Transparency**: Clearly communicate what cookies are being used and why
2. **Defaults**: Set conservative defaults (only necessary cookies enabled)
3. **Consistency**: Use the cookie service throughout the application
4. **Respect User Choices**: Always respect the user's cookie preferences
5. **Documentation**: Keep this document updated with any new cookies used in the application

## Legal Compliance

Ensure your cookie implementation complies with relevant regulations:

- **GDPR**: Requires explicit consent for non-essential cookies in the EU
- **CCPA**: Provides California residents with the right to opt-out of cookie tracking
- **ePrivacy Directive**: Requires informed consent before storing cookies

## Testing Cookie Implementation

To test if your cookies respect user consent:

1. Open browser developer tools (F12)
2. Go to the Application/Storage tab
3. Select Cookies from the sidebar
4. Accept/reject different cookie categories in the consent dialog
5. Verify only the appropriate cookies are being set

## Conclusion

Properly implementing cookie consent is both a legal requirement and a way to build trust with users. By following this guide, you can ensure your application handles cookies in a compliant and user-friendly manner. 