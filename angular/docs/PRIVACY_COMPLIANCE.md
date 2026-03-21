# Privacy Compliance Documentation

This document outlines how the application maintains compliance with global privacy regulations including GDPR, CCPA, LGPD, PIPEDA, and Australia's Privacy Act.

This is a **boilerplate template**. Features should be implemented to satisfy minimum compliance requirements. Easy to do now, hard to retrofit later.

---

## Table of Contents

1. [Regulations Overview](#regulations-overview)
2. [Privacy Policy Requirements](#privacy-policy-requirements)
3. [Terms of Service Requirements](#terms-of-service-requirements)
4. [User Data Collection](#user-data-collection)
5. [User Rights Implementation](#user-rights-implementation)
6. [Marketing and Consent](#marketing-and-consent)
7. [Country and Region Blocking](#country-and-region-blocking)
8. [Data Retention and Deletion](#data-retention-and-deletion)
9. [Implementation Checklist](#implementation-checklist)

---

## Regulations Overview

### Scope

| Regulation | Jurisdiction | Threshold | Key Difference |
|------------|--------------|-----------|---------------|
| **GDPR** | EU/EEA | Any EU resident data | Legal basis required, strict rights |
| **CCPA/CPRA** | California, USA | >$25M revenue OR >100K consumers OR 50%+ revenue from selling | Opt-out model for "sale/sharing" |
| **LGPD** | Brazil | Any Brazil resident data | 10 legal bases required |
| **PIPEDA** | Canada | Commercial activity | Consent-based |
| **Privacy Act** | Australia | >$3M turnover or government | APPs apply |

### Universal Rights (All Regulations)

| Right | GDPR | CCPA | LGPD | PIPEDA | Privacy Act |
|-------|------|------|------|--------|------------|
| Access to data | Art 15 | Know | Access | Access | Access |
| Correct inaccurate data | Art 16 | Correct | Correction | Accuracy | Correction |
| Delete data | Art 17 | Delete | Deletion | - | - |
| Data portability | Art 20 | Know | Portability | - | - |
| Object/Opt-out | Art 21 | Opt-out | Opposition | - | - |

### Regulation-Specific Requirements

| Requirement | Regulation | Implementation |
|-------------|------------|-----------------|
| "Do Not Sell/Share" link | CCPA | Toggle + footer link |
| Marketing consent | Privacy Act, LGPD | Opt-in (OFF by default) |
| Legal basis documentation | GDPR, LGPD | Privacy policy |
| Third-party disclosure | LGPD | Privacy policy |
| Age verification | California (2027) | Country blocking + OS signal |

---

## Privacy Policy Requirements

The privacy policy must contain specific sections to satisfy all regulations.

### Required Sections

#### 1. Identity and Contact Information

```
Controller: [Company Name]
Email: [contact@example.com]
Address: [Physical address]

Data Protection Officer: [if required by GDPR]
Contact: [dpo@example.com]
```

**Required by:** All regulations

---

#### 2. Data We Collect

**Required sections:**

```
Personal Information We Collect:
- Email address
- First name, last name
- Password (stored hashed)
- Authentication records (login attempts, timestamps)
- IP addresses (from login attempts)
- User agent information

[Note: We do NOT collect sensitive personal information including:
- Social Security Numbers
- Driver's license or passport numbers
- Financial account information
- Health or medical information
- Biometric data
- Precise geolocation
- Contents of private communications]
```

**Required by:** GDPR Art 13/14, CCPA "Know" right, LGPD, PIPEDA

---

#### 3. Legal Basis for Processing (GDPR/LGPD)

```
We process personal data under the following legal bases:

For Account Management:
- Contract performance: Authentication, profile management, password reset
- Legal obligation: Record retention for legal compliance

For Security Monitoring:
- Legitimate interest: Login attempt logging, IP reputation tracking, 
  pattern detection, security alerts
- Legal obligation: Security incident investigation

[For each processing activity, identify the legal basis]
```

**Required by:** GDPR Art 6, LGPD (10 bases)

---

#### 4. Why We Process Data (Purpose)

```
Purposes of Processing:

1. Account Authentication
   - Verify user identity
   - Maintain secure sessions
   - Prevent unauthorized access

2. Security Monitoring
   - Detect and prevent brute force attacks
   - Identify suspicious login patterns
   - Generate security alerts
   - Maintain IP reputation database

3. Service Improvement
   - Analyze login patterns
   - Detect credential stuffing attacks
   - Generate anonymized statistics
```

**Required by:** GDPR Art 13, PIPEDA (purpose identification), APPs

---

#### 5. Data Retention

```
Retention Periods:

- Account data: Until account deletion
- Login attempt records: [X months/years]
- Security logs: [X months/years]
- Anonymized statistics: Indefinitely (non-identifying)

After account deletion:
- Personal information is removed or anonymized
- Account cannot be recovered
- Some data may be retained for legal obligations
```

**Required by:** GDPR Art 13, LGPD, PIPEDA

---

#### 6. Third-Party Data Sharing

```
We may share data with:

1. Cloud Service Providers
   - Host: [AWS/GCP/Azure]
   - Purpose: Application hosting
   - Location: [Countries]

2. Email Service Providers
   - Purpose: Transactional emails
   - Data: Email address, name

3. Analytics Services
   - Purpose: Application analytics
   - Data: Anonymized/aggregated only

We do NOT sell personal information to third parties.

[List all third parties with purpose and data shared]
```

**Required by:** CCPA, LGPD (disclosure of sharing)

---

#### 7. International Data Transfers

```
Data Transfers:

Your data may be transferred to and processed in countries outside your region.

[For GDPR:]
We ensure appropriate safeguards through:
- Standard Contractual Clauses
- Adequacy decisions
- [Other safeguards]

[For Privacy Act:]
We may transfer data to overseas recipients.
Overseas recipients may not be subject to similar privacy laws.

[For LGPD:]
Data transfers comply with LGPD requirements for international transfers.
```

**Required by:** GDPR (Chapter V), Privacy Act (APP 8)

---

#### 8. User Rights

```
Your Rights:

Access: Request a copy of your personal data
Correction: Update inaccurate personal information
Deletion: Request account deletion
Portability: Download your data in machine-readable format
Restriction: Request limited processing of your data
Objection: Object to certain processing activities
Marketing Opt-out: Decline marketing communications

How to Exercise Rights:
[Link to privacy settings]
[Contact information]

Response Time: [Typically 30 days]
```

**Required by:** All regulations

---

#### 9. Automated Decision-Making

```
Automated Decisions:

We use automated systems for:
- IP address blocking (security)
- CAPTCHA challenges (security)
- Login attempt rate limiting (security)

These decisions may affect your access to the service.
You have the right to:
- Request human review of automated decisions
- Express your point of view
- Contest automated decisions

Contact us to exercise these rights.
```

**Required by:** GDPR Art 22, LGPD, PIPEDA

---

#### 10. Cookies and Tracking

```
Cookies:

We use [list cookies and their purposes]:
- Session cookies: Authentication
- Security cookies: CSRF protection
- [Other cookies]

[If using analytics:]
- Analytics cookies: [Purpose]

You can control cookie preferences through:
- Browser settings
- Cookie consent banner
```

**Required by:** GDPR, ePrivacy, CCPA

---

#### 11. Children's Privacy

```
Children:

This service is [not intended for / not directed to] children under [13/16].
We do not knowingly collect information from children.

[For California AB 1043 (effective 2027):]
California residents: We block access while implementing required age verification.
Age verification is handled through your device's operating system.
```

**Required by:** COPPA, CCPA, GDPR, Privacy Act

---

#### 12. Data Breach Procedures

```
Data Breaches:

In case of a data breach:
- We will notify affected users within [X] days
- We will report to relevant authorities within 72 hours (GDPR)
- [Outline response procedures]
```

**Required by:** GDPR Art 33/34, Privacy Act (APP 11)

---

#### 13. Changes to This Policy

```
Policy Updates:

We may update this privacy policy periodically.
Changes will be posted on this page.
[For significant changes:]
We will notify you via email.
[Date of last update]
```

**Required by:** All regulations

---

#### 14. Contact Information

```
Questions?

Contact our privacy team:
Email: [privacy@example.com]
Address: [Address]

[For GDPR:]
Data Protection Officer: [dpo@example.com]

[For Australia:]
Privacy Officer: [Required under Privacy Act]
```

---

## Terms of Service Requirements

### Required Sections

#### 1. Acceptance of Terms

```
By using this service, you agree to these terms.
If you do not agree, do not use the service.
```

---

#### 2. Description of Service

```
This is a [description] service.
[Explain what the service does]
```

---

#### 3. User Accounts

```
Account Requirements:
- Valid email address
- Secure password
- Accurate information

Account Security:
- You are responsible for maintaining password security
- Report unauthorized access immediately
- [Password requirements]
```

---

#### 4. Acceptable Use

```
You agree not to:
- Use for illegal purposes
- Attempt unauthorized access
- Interfere with service operation
- [Other restrictions]

We reserve the right to:
- Suspend accounts for violations
- Terminate accounts for repeated violations
- Block IPs for suspicious activity
```

---

#### 5. Intellectual Property

```
Content:
- [Define ownership of user content vs. service content]
- License you grant us for content you create
```

---

#### 6. Limitation of Liability

```
[Standard limitation of liability clauses]
[Dispute resolution procedures]
```

---

#### 7. Account Deletion

```
You may delete your account at any time.
Upon deletion:
- Personal information is removed
- Account cannot be recovered
- Some data may be retained per legal obligations

See our Privacy Policy for details.
```

---

#### 8. Governing Law

```
These terms are governed by [jurisdiction] law.
Disputes are subject to [jurisdiction] courts.
```

---

## User Data Collection

### Data We Collect

| Data Type | Purpose | Legal Basis (GDPR) | Retention |
|-----------|---------|-------------------|-----------|
| Email | Authentication | Contract | Until deletion |
| Password (hashed) | Authentication | Contract | Until deletion |
| FirstName, LastName | Profile | Contract | Until deletion |
| Login attempts (IP, timestamp, status) | Security | Legitimate Interest | [X months] |
| IP reputation | Security | Legitimate Interest | [X months] |

### Data We DON'T Collect

- Sensitive personal information (SSN, driver's license, etc.)
- Precise geolocation
- Health or biometric data
- Contents of private communications
- Financial account numbers

---

## User Rights Implementation

### Self-Service Features

| Feature | Endpoint | Description |
|---------|----------|-------------|
| Export Data | GET /privacy/export | Download all personal data |
| Delete Account | DELETE /privacy/account | Remove account and data |
| Update Profile | PATCH /users/:id | Correct personal information |
| Restrict Processing | PATCH /privacy/restrict | Limit future processing |
| Marketing Toggle | PATCH /privacy/marketing | Opt-in/out of marketing |

### Support Ticket Escalation

For requests that cannot be self-serviced:
- Non-verifiable records (e.g., typos with non-existent emails)
- Complex deletion requests
- Appeals of automated decisions
- Identity verification issues

---

## Marketing and Consent

### Implementation

```typescript
// User entity additions
marketingConsent: boolean = false;  // Default: no marketing
doNotSell: boolean = false;         // Default: not opted out (we don't sell anyway)

// Only send marketing if:
if (user.marketingConsent === true) {
  // Send marketing email
}
```

### UI Requirements

| Screen | Element | Default State |
|--------|---------|---------------|
| Registration | Marketing consent checkbox | Unchecked |
| Settings > Privacy | Marketing toggle | Off |
| Footer | "Do Not Sell My Information" link | Links to privacy settings |

### Privacy Policy Language

```
Marketing:

We do not sell your personal information.

If you have opted in to marketing communications, we may send you:
- Product updates
- Newsletters
- Promotional offers

You can opt out at any time through:
- Privacy settings in your account
- The unsubscribe link in any email

Default: Marketing communications are disabled.
```

---

## Country and Region Blocking

### Purpose

Block users from jurisdictions where:
- We don't have legal infrastructure to comply
- Age verification requirements aren't met
- Regulatory risk is too high

### Implementation

#### Free Tools Available

| Tool | Package | Description |
|------|---------|-------------|
| geoip-country | geoip-country | MaxMind GeoLite2, weekly updates |
| geoip-lite | geoip-lite | Lightweight country lookup |
| node-ipgeoblock | node-ipgeoblock | Express middleware |

#### Example Implementation

```typescript
// backend/src/common/middleware/geo-block.middleware.ts
import * as geoip from 'geoip-country';
import { Injectable, NestMiddleware } from '@nestjs/common';

@Injectable()
export class GeoBlockMiddleware implements NestMiddleware {
  private blockedCountries = ['US-CA']; // California, USA

  use(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip;
    const geo = geoip.lookup(ip);
    
    if (geo && this.isBlocked(geo.country)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'This service is not available in your region.',
      });
    }
    
    next();
  }

  private isBlocked(countryCode: string): boolean {
    return this.blockedCountries.includes(countryCode);
  }
}
```

#### Configuration

```typescript
// backend/src/config/configuration.ts
export default () => ({
  geoBlocking: {
    enabled: process.env.GEO_BLOCK_ENABLED === 'true',
    blockedCountries: (process.env.GEO_BLOCK_COUNTRIES || 'US-CA').split(','),
    blockedRegions: process.env.GEO_BLOCK_REGIONS || '',
  },
});
```

#### Environment Variables

```bash
# Enable geo blocking
GEO_BLOCK_ENABLED=true

# Comma-separated list of country codes
# Use format COUNTRY-REGION for regional blocking (e.g., US-CA for California)
GEO_BLOCK_COUNTRIES=US-CA,EU,AU

# Or for regional databases:
GEO_BLOCK_REGIONS=California,Bavaria
```

#### Future: California Age Verification (AB 1043)

**Effective January 1, 2027:**
- California requires age verification via OS-level signals
- Until we implement OS signal integration, California is blocked
- After 2027, we must:
  1. Request age bracket signal from OS
  2. Block users under required age thresholds
  3. Not discriminate against users based on age (unless required by law)

#### Regional Blocking Options

| Level | Example | Implementation |
|-------|---------|---------------|
| Country | Germany | `DE` |
| Region | California | `US-CA` |
| EU | All EU | `EU` (if supported) |
| Custom | Multiple | `US-CA,US-NY,AU` |

---

## Data Retention and Deletion

### Retention Schedule

| Data Type | Retention Period | Reason |
|-----------|------------------|--------|
| User profile | Until deletion | Service requirement |
| Login attempts | 12 months | Security, fraud prevention |
| Security alerts | 12 months | Security investigation |
| IP reputation | 6 months | Security scoring |
| Audit logs | 24 months | Compliance |

### Deletion Process

1. User requests deletion
2. Verify user identity (must be logged in)
3. Remove/anonymize personal information:
   - Email → nullified
   - Name → nullified
   - Profile → anonymized
4. Keep for legal obligation (if applicable):
   - Anonymized aggregate data
   - Transaction records (tax purposes)
5. Log deletion for audit trail
6. Send confirmation email

### Anonymization (LGPD)

For LGPD compliance, users may request anonymization instead of deletion.

**Implementation:**
- Replace identifying fields with null/random values
- Keep aggregate statistics for system improvement
- Account becomes non-functional
- User cannot log in after anonymization

**Note:** This is functionally equivalent to deletion for an account-based system.

---

## Implementation Checklist

### Privacy Policy

- [ ] Identity and contact information section
- [ ] Data collection section (what we collect)
- [ ] Legal basis section (GDPR/LGPD)
- [ ] Purpose section (why we collect)
- [ ] Retention schedule section
- [ ] Third-party disclosure section
- [ ] International transfer section
- [ ] User rights section
- [ ] Automated decision-making section
- [ ] Cookies section
- [ ] Children's privacy section
- [ ] Breach notification section
- [ ] Policy update procedure
- [ ] Contact information

### Terms of Service

- [ ] Acceptance section
- [ ] Service description
- [ ] Account requirements
- [ ] Acceptable use policy
- [ ] Account deletion terms
- [ ] Governing law

### Technical Implementation

- [ ] User data export endpoint
- [ ] Account deletion endpoint
- [ ] Profile correction endpoint
- [ ] Restrict processing endpoint
- [ ] Marketing consent toggle
- [ ] "Do Not Sell" toggle
- [ ] Geo-blocking middleware
- [ ] Support ticketing system

### Legal Documentation

- [ ] Legitimate interest assessment (for security logging)
- [ ] Data processing agreement (for third parties)
- [ ] Breach response procedures
- [ ] Retention policy documentation

---

## References

- GDPR: https://gdpr.eu/
- CCPA: https://oag.ca.gov/privacy/ccpa
- LGPD: http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709.htm
- PIPEDA: https://www.priv.gc.ca/en/privacy_privacy/
- Privacy Act (Australia): https://www.oaic.gov.au/privacy/the-privacy-act
- California AB 1043: Digital Age Assurance Act (effective 2027)
