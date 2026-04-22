# Privacy Compliance Implementation Plan

## Overview

This plan implements privacy compliance features for GDPR, CCPA, LGPD, PIPEDA, and Australia's Privacy Act.

**This is a boilerplate template.** Features should be implemented to satisfy minimum compliance requirements. Easy to do now, hard to retrofit later.

---

## Documentation vs Implementation

This document distinguishes between:

| Type | Description | Effort |
|------|-------------|--------|
| **Documentation** | Privacy policy text, legal disclosures, policies | Writing/formatting |
| **Feature** | Code that implements functionality | Development/testing |

---

## Documentation Items (Not Features)

These items belong in your privacy policy, terms of service, or internal documentation. **No code changes required.**

### Privacy Policy Sections

| Section | Document | Where | Why Required |
|---------|----------|-------|-------------|
| Identity/Contact | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | All regulations |
| Data We Collect | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR Art 13, CCPA, LGPD |
| Legal Basis (GDPR) | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR Art 6 |
| Legal Basis (LGPD) | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | LGPD 10 bases |
| Processing Purpose | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR Art 13, PIPEDA |
| Data Retention Schedule | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR Art 13, LGPD |
| Third-Party Disclosures | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | CCPA, LGPD |
| International Transfers | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR Ch V, Privacy Act APP 8 |
| User Rights Summary | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | All regulations |
| Automated Decision-Making | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR Art 22, LGPD |
| Cookies | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR, ePrivacy |
| Children's Privacy | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | COPPA, CCPA |
| Data Breach Procedures | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | GDPR Art 33/34 |
| Policy Update Procedure | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | All regulations |
| Regional Restrictions | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | AB 1043, general |
| **Marketing Opt-Out Statement** | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | CCPA, Privacy Act |
| **"We Do Not Sell" Statement** | Privacy Policy | `docs/PRIVACY_COMPLIANCE.md` | CCPA |

### Terms of Service Sections

| Section | Document | Where | Why Required |
|---------|----------|-------|-------------|
| Acceptance | Terms of Service | `docs/TERMS_OF_SERVICE.md` | General |
| Service Description | Terms of Service | `docs/TERMS_OF_SERVICE.md` | General |
| Account Requirements | Terms of Service | `docs/TERMS_OF_SERVICE.md` | General |
| Acceptable Use | Terms of Service | `docs/TERMS_OF_SERVICE.md` | General |
| IP Blocking Policy | Terms of Service | `docs/TERMS_OF_SERVICE.md` | General |
| Account Deletion | Terms of Service | `docs/TERMS_OF_SERVICE.md` | GDPR, CCPA |
| Governing Law | Terms of Service | `docs/TERMS_OF_SERVICE.md` | General |

### Internal Documentation

| Document | Purpose | Where |
|---------|---------|-------|
| Legitimate Interest Assessment | GDPR compliance | `docs/LEGITIMATE_INTEREST_ASSESSMENT.md` |
| Retention Policy | Data retention compliance | `docs/RETENTION_POLICY.md` |
| Breach Response Procedures | Incident response | `docs/BREACH_RESPONSE.md` |
| Privacy Impact Assessment | GDPR (if required) | `docs/PRIVACY_IMPACT_ASSESSMENT.md` |

### Privacy Policy Template

See `angular/docs/PRIVACY_COMPLIANCE.md` Section 2 for complete privacy policy template with all required sections.

---

## Feature Implementation

These items require code changes.

### User Entity Updates

**Add to `backend/src/modules/users/entities/user.entity.ts`:**

```typescript
// Marketing consent (opt-in)
@Column({ default: false })
marketingConsent: boolean;

// CCPA "Do Not Sell" flag
@Column({ default: false })
doNotSell: boolean;

// Privacy preference tracking
@CreateDateColumn()
consentUpdatedAt: Date;
```

### Backend Features

| Feature | Endpoint | File | Purpose |
|---------|----------|------|---------|
| Export User Data | GET /privacy/export | `privacy.controller.ts` | GDPR Art 20, CCPA "Know" |
| Delete Account | DELETE /privacy/account | `privacy.controller.ts` | GDPR Art 17, CCPA Delete |
| Update Profile | PATCH /users/:id | Existing | GDPR Art 16, CCPA Correct |
| Restrict Processing | PATCH /privacy/restrict | `privacy.controller.ts` | GDPR Art 18 |
| Object to Processing | POST /privacy/object | `privacy.controller.ts` | GDPR Art 21 |
| Marketing Toggle | PATCH /privacy/marketing | `privacy.controller.ts` | CCPA, Privacy Act |
| "Do Not Sell" Toggle | PATCH /privacy/do-not-sell | `privacy.controller.ts` | CCPA |
| Support Tickets | POST /privacy/tickets | `privacy-ticket.controller.ts` | Complex requests |

### Frontend Features

| Feature | Component | Purpose |
|---------|-----------|---------|
| Privacy Dashboard | `privacy-dashboard/` | Central settings location |
| Data Export | `export-data-dialog/` | Download personal data |
| Delete Account | `delete-account-dialog/` | Account deletion |
| Restriction Toggles | `privacy-restrictions/` | GDPR Art 18 |
| Objection Form | `objection-form/` | GDPR Art 21 |
| Marketing Toggle | `marketing-consent/` | Opt-in/out |
| Support Ticket | `submit-ticket/` | Complex requests |

### Geo-Blocking Features

| Feature | File | Purpose |
|---------|------|---------|
| Geo-Block Middleware | `geo-block.middleware.ts` | Block by country/region |
| Access Denied Page | `blocked.component/` | Show blocked message |
| Configuration | Environment variables | Simple setup |

See `angular/docs/implementation-plans/COUNTRY_REGION_BLOCKING.md`

---

## Two-Tier Architecture

### Tier 1: Self-Service (User-Facing)

For records where `userId` is linked. Users can exercise rights directly.

| Right | Scope | Implementation |
|-------|-------|---------------|
| **Export** | Profile + linked login history | Download JSON/CSV |
| **Delete** | Linked records only | User selects → deletes |
| **Restrict** | Future logging preferences | Toggle switches |
| **Object** | Specific processing types | Checkbox preferences |
| **Marketing** | Marketing consent | Opt-in toggle |
| **Do Not Sell** | Data selling/sharing | Opt-out toggle |

### Tier 2: Support Ticketing

For non-verifiable requests and complex cases.

| Scenario | Handling |
|----------|----------|
| Non-existent email attempts | Cannot verify ownership |
| Identity verification issues | Support investigates |
| Complex deletion requests | Support has elevated rights |
| Appeals of automated decisions | Human review |

---

## Regulation-Specific Requirements

### GDPR (European Union)

| Requirement | Type | Implementation |
|-------------|------|----------------|
| Right of access (Art 15) | Feature | User data export |
| Right to rectification (Art 16) | Feature | Existing PATCH endpoint |
| Right to erasure (Art 17) | Feature | Account deletion |
| Right to restrict (Art 18) | Feature | Restriction toggles |
| Right to portability (Art 20) | Feature | Data export |
| Right to object (Art 21) | Feature | Objection form |
| Automated decisions (Art 22) | Feature | Decision log + contest |
| Legal basis (Art 6) | Documentation | Privacy policy |
| Purpose (Art 13) | Documentation | Privacy policy |
| Retention (Art 13) | Documentation | Privacy policy |
| Third parties (Art 13) | Documentation | Privacy policy |
| Transfers (Chapter V) | Documentation | Privacy policy |
| Breach notification (Art 33) | Documentation | Privacy policy + procedures |

### CCPA (California)

| Requirement | Type | Implementation |
|-------------|------|----------------|
| Right to know | Feature | Data export |
| Right to delete | Feature | Account deletion |
| Right to correct | Feature | Existing PATCH endpoint |
| Right to opt-out | Feature | "Do Not Sell" toggle |
| "Do Not Sell" link | Feature | Footer link + toggle |
| Sensitive PI controls | Documentation | Privacy policy (if applicable) |
| Request verification | Feature | Logged-in users only |
| Response timeline | Documentation | 45 days (internal) |

### LGPD (Brazil)

| Requirement | Type | Implementation |
|-------------|------|----------------|
| Access | Feature | Data export |
| Correction | Feature | Existing PATCH endpoint |
| Deletion/Anonymization | Feature | Account deletion |
| Portability | Feature | Data export |
| Consent management | Feature | Marketing opt-in |
| Legal bases (10) | Documentation | Privacy policy |
| Third-party disclosure | Documentation | Privacy policy |
| International transfers | Documentation | Privacy policy |

### PIPEDA (Canada)

| Requirement | Type | Implementation |
|-------------|------|----------------|
| Access | Feature | Data export |
| Accuracy | Feature | Existing PATCH endpoint |
| Meaningful consent | Documentation | UI design guidelines |
| Purpose identification | Documentation | Privacy policy |

### Privacy Act (Australia)

| Requirement | Type | Implementation |
|-------------|------|----------------|
| Access (APP 11) | Feature | Data export |
| Correction (APP 12) | Feature | Existing PATCH endpoint |
| APP compliance | Documentation | Privacy policy |
| Anonymity (APP 2) | Documentation | Note: not available |
| Marketing consent (APP 7) | Feature | Marketing opt-in |
| Cross-border (APP 8) | Documentation | Privacy policy |

---

## Marketing Consent Implementation

### Why Opt-In (OFF by Default)

| Regulation | Requirement | Our Implementation |
|-----------|-------------|-------------------|
| CCPA | "Do Not Sell/Share" | `doNotSell` toggle (OFF = not selling) |
| Privacy Act (AUS) | Explicit consent | `marketingConsent` (default false) |
| LGPD | Explicit consent | `marketingConsent` (default false) |

**This approach satisfies all regulations with one simple field.**

### Privacy Policy Language

```markdown
## Marketing Communications

We do not sell your personal information.

If you have opted in to marketing communications, we may send you:
- Product updates
- Newsletters
- Promotional offers

You can opt out at any time through your account settings.

Default: Marketing communications are disabled.
```

---

## California Age Verification (AB 1043)

**Not implementing age verification. Blocking California users instead.**

### Implementation

See `angular/docs/implementation-plans/COUNTRY_REGION_BLOCKING.md`

### Privacy Policy Language

```markdown
## Regional Restrictions

This service may not be available in all jurisdictions due to local regulations,
including age verification requirements.

California residents: We currently block access while evaluating compliance options.

If you believe you've received this message in error, please contact support.
```

---

## Privacy Ticket System Requirements

### Overview

The privacy ticket system handles complex privacy requests that cannot be resolved through self-service. It supports both authenticated users and anonymous (public) submissions.

### Configuration

Add to `backend/src/config/environment.config.ts`:

```typescript
privacy: {
  ticketRetentionDays: number,      // Closed ticket retention (default: 365)
  dataRetentionDays: number,        // User data retention (default: 730)
  defaultDeadlineDays: number,      // Internal deadline (default: 14)
  slaWarningDays: number,           // Days before deadline to warn (default: 2)
}

// Hardcoded statutory deadlines (not configurable)
gdpr: { deadlineDays: 30, extensionDays: 60 }   // Total: 90 days
ccpa: { deadlineDays: 45, extensionDays: 45 }   // Total: 90 days
```

### Entity: PrivacyTicket

| Field | Type | Description |
|-------|------|-------------|
| id | number | Primary key |
| requestType | enum | access, deletion, correction, restriction, objection, portability, other |
| status | enum | pending, in_review, needs_info, completed, rejected |
| description | text | User's request details |
| userId | FK (nullable) | Link to authenticated user |
| email | string (nullable) | For anonymous submissions |
| ipAddress | string | For audit/verification |
| regulation | enum | gdpr, ccpa, other, unknown |
| assignedTo | FK (nullable) | Admin user working the ticket |
| assignedAt | datetime | When ticket was picked up |
| completedBy | FK (nullable) | Admin who resolved |
| completedAt | datetime | When resolved |
| slaDeadline | datetime | Calculated deadline |
| needsInfoFromUser | boolean | SLA pause flag |
| needsInfoAt | datetime | When marked needs info |
| needsInfoResolvedAt | datetime | When user responded |
| responseCount | number | Track iterations |
| adminNotes | text (nullable) | Internal notes |
| rejectionReason | text (nullable) | If rejected |
| resolution | text (nullable) | If completed |
| retentionOverride | boolean | Flag for legal hold |
| createdAt | datetime | |
| updatedAt | datetime | |

### Entity: PrivacyTicketMagicLink

For anonymous users to access their tickets.

| Field | Type | Description |
|-------|------|-------------|
| id | number | Primary key |
| ticketId | FK | Link to ticket |
| token | string | Unique access token |
| expiresAt | datetime | 24 hours from creation |
| usedAt | datetime (nullable) | When used |

### Permissions

| Permission | Description |
|------------|-------------|
| privacy:tickets:create | Submit privacy request |
| privacy:tickets:read:own | View own tickets |
| privacy:tickets:read:all | View all tickets (admin) |
| privacy:tickets:manage | Assign, update, resolve (admin) |
| privacy:manage | Full privacy management access |

### Backend Endpoints

#### Public (No Auth Required)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /privacy/tickets/public | Submit anonymous request |
| GET | /privacy/tickets/public/:token | View ticket status (magic link) |

#### Authenticated (User)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /privacy/tickets | List own tickets |
| POST | /privacy/tickets | Create new ticket |
| GET | /privacy/tickets/:id | View ticket details |

#### Authenticated (Admin)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /privacy/admin/tickets | List all tickets |
| PATCH | /privacy/admin/tickets/:id | Update status/assign |
| POST | /privacy/admin/tickets/:id/assign | Assign to admin |
| POST | /privacy/admin/tickets/:id/resolve | Mark resolved |
| POST | /privacy/admin/tickets/:id/reject | Mark rejected |

### Workflow States

```
pending → in_review → needs_info → (completed | rejected)
```

- **pending**: Newly submitted, unassigned
- **in_review**: Assigned to admin, being worked
- **needs_info**: Waiting on user response (pauses GDPR SLA)
- **completed**: Successfully resolved
- **rejected**: Denied (requires rejection reason)

### SLA Handling

| Regulation | Deadline | Extension | Clock Behavior |
|------------|----------|-----------|----------------|
| GDPR | 30 days | +60 days (90 total) | PAUSES when needs_info |
| CCPA | 45 days | +45 days (90 total) | Does NOT pause |
| Other | Config (14 days) | N/A | Internal deadline |

**Internal Deadline**: Configurable (default 14 days) - our own target, separate from statutory.

**Deadline Breach**: Flag as "overdue" - requires manual escalation.

### Data Retention

| Ticket State | Retention | Action |
|--------------|-----------|--------|
| Open | Until resolved | Keep |
| Closed/Completed | Config (default: 365 days) | Keep for audit |
| After retention period | N/A | Auto-delete |
| Deletion request received | Immediately | Delete ticket data too |

**Retention Override**: If ticket related to legal dispute, set flag to prevent auto-deletion.

### Email Verification

- **Anonymous users**: Require email, send verification link
- **Logged-in users**: Use account data (no additional verification)
- **CAPTCHA**: Required on all public forms

### Magic Link Flow

1. Anonymous user submits with email
2. System generates token, sends to email
3. User clicks link → can view status, add comments
4. Token expires after 24 hours or when resolved

---

## Notifications

### Universal Notification System

- **Bell icon in header**: Shows unread notification count
- **Types**: Privacy tickets (new/overdue), security alerts, system notices
- **Admin notifications**: Email alerts for new tickets, SLA warnings, breaches
- **Configuration**: Configurable notification preferences

### Notification Types

| Type | Trigger | Recipients |
|------|---------|------------|
| New ticket | Public submission | All admins with privacy:manage |
| SLA warning | 24h before deadline | Assigned admin |
| SLA breach | Deadline passed | All admins |
| Ticket resolved | Completion | User (if authenticated) |

---

## Frontend Pages

### Public
- `/privacy/request` - Submit anonymous request (CAPTCHA required)

### Authenticated
- `/app/privacy` - User's privacy settings and ticket history
- `/app/privacy/tickets` - Submit/view own tickets

### Admin
- `/app/admin/privacy-requests` - Ticket management (standalone page)
- Sidebar: Add under "Admin" section

### Navigation
- Header: User profile dropdown → "Privacy Requests"
- Header: Bell icon for notifications
- Footer (public): "Privacy Requests" link
- Sidebar: "Privacy Requests" under Admin section

---

## Implementation Tasks

### Phase 1: User Entity Updates

- [x] Add `marketingConsent` field
- [x] Add `doNotSell` field
- [x] Add `consentUpdatedAt` timestamp

### Phase 2: Backend Features

- [x] Create privacy module structure
- [x] Implement export service
- [x] Implement erasure service
- [x] Add restriction toggles
- [x] Add objection service

### Phase 3: Frontend Features

- [x] Privacy dashboard component
- [x] Data export dialog
- [x] Delete account dialog
- [x] Restriction toggles
- [x] Marketing consent toggle
- [x] "Do Not Sell" toggle

### Phase 4: Geo-Blocking

- [x] Implement geo-block middleware
- [x] Create blocked page
- [x] Configure for California

### Phase 5: Privacy Ticket System

- [ ] Add privacy config to `environment.config.ts`
- [ ] Create PrivacyTicket entity with all fields
- [ ] Create PrivacyTicketMagicLink entity
- [ ] Add permissions: privacy:tickets:*, privacy:manage
- [ ] Implement public ticket endpoints (with CAPTCHA)
- [ ] Implement authenticated ticket endpoints
- [ ] Implement admin ticket endpoints
- [ ] Add SLA calculation and tracking
- [ ] Implement magic link generation/validation
- [ ] Create email service stub with logging
- [ ] Add ticket management frontend page
- [ ] Add sidebar navigation link
- [ ] Add notification bell to header
- [ ] Implement universal notification system

### Privacy Ticket System - Detailed Implementation Requirements

#### 1. Configuration

**File**: `backend/src/config/environment.config.ts`

Add new config section:
```typescript
privacy: {
  ticketRetentionDays: parseInt(process.env.PRIVACY_TICKET_RETENTION_DAYS, 10) || 365,
  dataRetentionDays: parseInt(process.env.PRIVACY_DATA_RETENTION_DAYS, 10) || 730,
  defaultDeadlineDays: parseInt(process.env.PRIVACY_DEFAULT_DEADLINE_DAYS, 10) || 14,
  slaWarningDays: parseInt(process.env.PRIVACY_SLA_WARNING_DAYS, 10) || 2,
}
```

#### 2. Backend Entities

**PrivacyTicket Entity**: `backend/src/modules/privacy/entities/privacy-ticket.entity.ts`
```typescript
@Entity('privacy_tickets')
export class PrivacyTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: ['access', 'deletion', 'correction', 'restriction', 'objection', 'portability', 'other'] })
  requestType: TicketRequestType;

  @Column({ type: 'enum', enum: ['pending', 'in_review', 'needs_info', 'completed', 'rejected'], default: 'pending' })
  status: TicketStatus;

  @Column('text')
  description: string;

  @Column({ nullable: true })
  userId: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ type: 'enum', enum: ['gdpr', 'ccpa', 'other', 'unknown'], default: 'unknown' })
  regulation: TicketRegulation;

  @Column({ nullable: true })
  assignedTo: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assignedTo' })
  assignedAdmin: User;

  @Column({ nullable: true })
  assignedAt: Date;

  @Column({ nullable: true })
  completedBy: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'completedBy' })
  completedAdmin: User;

  @Column({ nullable: true })
  completedAt: Date;

  @Column({ type: 'timestamp' })
  slaDeadline: Date;

  @Column({ default: false })
  needsInfoFromUser: boolean;

  @Column({ nullable: true })
  needsInfoAt: Date;

  @Column({ nullable: true })
  needsInfoResolvedAt: Date;

  @Column({ default: 0 })
  responseCount: number;

  @Column({ type: 'text', nullable: true })
  adminNotes: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @Column({ type: 'text', nullable: true })
  resolution: string;

  @Column({ default: false })
  retentionOverride: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

**PrivacyTicketMagicLink Entity**: `backend/src/modules/privacy/entities/privacy-ticket-magic-link.entity.ts`

#### 3. Permissions to Create

Add to permission seeds (`backend/src/database/seeds/permission-seeds.service.ts`):
| Permission | Description |
|------------|-------------|
| `privacy:tickets:create` | Submit privacy request |
| `privacy:tickets:read:own` | View own tickets |
| `privacy:tickets:read:all` | View all tickets (admin) |
| `privacy:tickets:manage` | Assign, update, resolve (admin) |
| `privacy:manage` | Full privacy management access |

#### 4. Backend Endpoints

**Public Controller**: `backend/src/modules/privacy/privacy-public.controller.ts`
| Method | Endpoint | Purpose | CAPTCHA |
|--------|----------|---------|---------|
| POST | /privacy/tickets/public | Submit anonymous request | YES |
| POST | /privacy/tickets/public/verify-email | Send magic link | YES |
| GET | /privacy/tickets/public/:token | View ticket status | NO (token auth) |

**User Controller**: `backend/src/modules/privacy/privacy-ticket.controller.ts` (existing, update)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /privacy/tickets | List own tickets |
| POST | /privacy/tickets | Create new ticket (auth'd) |
| GET | /privacy/tickets/:id | View ticket details |

**Admin Controller**: `backend/src/modules/privacy/privacy-admin.controller.ts` (new)
| Method | Endpoint | Purpose | Permission |
|--------|----------|---------|-------------|
| GET | /privacy/admin/tickets | List all tickets | privacy:tickets:read:all |
| GET | /privacy/admin/tickets/:id | View ticket | privacy:tickets:read:all |
| PATCH | /privacy/admin/tickets/:id | Update ticket | privacy:tickets:manage |
| POST | /privacy/admin/tickets/:id/assign | Assign to admin | privacy:tickets:manage |
| POST | /privacy/admin/tickets/:id/resolve | Mark resolved | privacy:tickets:manage |
| POST | /privacy/admin/tickets/:id/reject | Mark rejected | privacy:tickets:manage |
| POST | /privacy/admin/tickets/:id/request-info | Request more info | privacy:tickets:manage |

**CAPTCHA Integration**: Use existing `CaptchaService` from `backend/src/modules/auth/services/captcha.service.ts`
- Public endpoints must validate CAPTCHA before processing
- Use `captchaService.validate(captchaToken, captchaSolution)`

#### 5. Email Notifications

The email module is already implemented at `backend/src/modules/email/`. See `EMAIL_SERVICE.md` for full details.

**Email Service**: `backend/src/modules/email/email.service.ts`

Privacy ticket methods available:
- `sendTicketSubmittedEmail()` - Confirmation to user
- `sendTicketAssignedEmail()` - Notification to admin
- `sendSlaWarningEmail()` - SLA warning to admin
- `sendTicketResolvedEmail()` - Resolution to user
- `sendTicketRejectedEmail()` - Rejection to user

**Email Templates**: `backend/src/modules/email/providers/templates/`

##### 5.1 Ticket Submitted Confirmation

**File**: `backend/src/modules/email/providers/templates/ticket-submitted.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Ticket Submitted</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #3f51b5; color: #ffffff; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .cta-container { text-align: center; margin: 30px 0; }
    .button { display: inline-block; background-color: #ff9800; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; font-size: 16px; }
    .footer { text-align: center; font-size: 12px; color: #666; margin-top: 20px; padding: 20px; }
    .ticket-info { background-color: white; padding: 15px; margin: 15px 0; border-radius: 4px; border-left: 4px solid #3f51b5; }
    .priority { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-left: 10px; }
    .priority.high { background-color: #f44336; color: white; }
    .priority.medium { background-color: #ff9800; color: white; }
    .priority.low { background-color: #4caf50; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Privacy Ticket Submitted</h1>
    </div>
    <div class="content">
      <p>Hello {{ userName }},</p>
      <p>Your privacy request has been successfully submitted and is now being processed.</p>
      
      <div class="ticket-info">
        <h3>Ticket Details</h3>
        <p><strong>Ticket ID:</strong> {{ ticketId }}</p>
        <p><strong>Type:</strong> {{ ticketType }}</p>
        <p><strong>Priority:</strong> <span class="priority {{ ticketPriority }}">{{ ticketPriority }}</span></p>
        <p><strong>Submitted:</strong> {{ submittedAt }}</p>
      </div>
      
      <p>We have received your request and our privacy team will review it within 1-2 business days.</p>
      
      <div class="cta-container">
        <a class="button" href="{{ ticketUrl }}">View Ticket Status</a>
      </div>
      
      <p>If you need to provide additional information or documents, you can upload them directly from your ticket dashboard.</p>
      
      <p>Best regards,<br>Privacy Team</p>
    </div>
    <div class="footer">
      <p>This is an automated email. Please do not reply to this message.</p>
      <p>&copy; {{ currentYear }} {{ appName }}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
```

##### 5.2 Ticket Assigned (Admin Notification)

**File**: `backend/src/modules/email/providers/templates/ticket-assigned.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Privacy Ticket Assigned</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #3f51b5; color: #ffffff; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .cta-container { text-align: center; margin: 30px 0; }
    .button { display: inline-block; background-color: #ff9800; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 4px; }
    .ticket-info { background-color: white; padding: 15px; margin: 15px 0; border-radius: 4px; border-left: 4px solid #3f51b5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Privacy Ticket Assigned</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>A new privacy ticket has been assigned to you for review.</p>
      
      <div class="ticket-info">
        <h3>Ticket Details</h3>
        <p><strong>Ticket ID:</strong> {{ ticketId }}</p>
        <p><strong>Assigned At:</strong> {{ assignedAt }}</p>
        <p><strong>Estimated Timeframe:</strong> {{ estimatedTimeframe }}</p>
      </div>
      
      <div class="cta-container">
        <a class="button" href="{{ ticketUrl }}">Review Ticket</a>
      </div>
    </div>
  </div>
</body>
</html>
```

##### 5.3 SLA Warning

**File**: `backend/src/modules/email/providers/templates/sla-warning.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SLA Warning</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #ff9800; color: #ffffff; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .warning-box { background-color: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SLA Warning</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>A privacy ticket is approaching its resolution deadline.</p>
      
      <div class="warning-box">
        <h3>Ticket Details</h3>
        <p><strong>Ticket ID:</strong> {{ ticketId }}</p>
        <p><strong>Time Remaining:</strong> {{ timeRemaining }}</p>
        <p><strong>SLA Metric:</strong> {{ slaMetric }}</p>
      </div>
      
      <p>Please ensure this ticket is addressed promptly to maintain compliance.</p>
    </div>
  </div>
</body>
</html>
```

##### 5.4 Ticket Resolved

**File**: `backend/src/modules/email/providers/templates/ticket-resolved.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Privacy Ticket Resolved</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4caf50; color: #ffffff; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .resolution-box { background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Request Resolved</h1>
    </div>
    <div class="content">
      <p>Hello {{ userName }},</p>
      <p>Your privacy request has been completed.</p>
      
      <div class="resolution-box">
        <h3>Resolution Details</h3>
        <p><strong>Ticket ID:</strong> {{ ticketId }}</p>
        <p><strong>Resolved At:</strong> {{ resolvedAt }}</p>
        <p><strong>Resolution:</strong> {{ resolutionAction }}</p>
      </div>
      
      <p>If you have any further questions, please contact our privacy team.</p>
    </div>
  </div>
</body>
</html>
```

##### 5.5 Ticket Rejected

**File**: `backend/src/modules/email/providers/templates/ticket-rejected.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Privacy Ticket Rejected</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f44336; color: #ffffff; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .rejection-box { background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Request Rejected</h1>
    </div>
    <div class="content">
      <p>Hello {{ userName }},</p>
      <p>We are writing to inform you that your privacy request could not be fulfilled at this time.</p>
      
      <div class="rejection-box">
        <h3>Rejection Details</h3>
        <p><strong>Ticket ID:</strong> {{ ticketId }}</p>
        <p><strong>Reason:</strong> {{ rejectionReason }}</p>
        <p><strong>Reference:</strong> {{ rejectionReference }}</p>
      </div>
      
      <p>If you believe this decision was made in error, you may file an appeal through the link above.</p>
    </div>
  </div>
</body>
</html>
```

Email triggers:
- Ticket submitted (confirmation to user) → `sendTicketSubmittedEmail()`
- Ticket assigned (admin notification) → `sendTicketAssignedEmail()`
- SLA warning (admin notification) → `sendSlaWarningEmail()`
- Ticket resolved (user notification) → `sendTicketResolvedEmail()`
- Ticket rejected (user notification) → `sendTicketRejectedEmail()`

#### 6. Frontend Pages

**Public Submission Page**: `frontend/src/app/features/privacy/public-request.component.ts`
- Route: `/privacy/request`
- Requires CAPTCHA using `CaptchaService` from `frontend/src/app/core/services/captcha.service.ts`
- Uses `captcha-selector.component.ts` for visual CAPTCHA

**User Privacy Page**: `frontend/src/app/features/privacy/privacy-settings.component.ts` (existing, update)
- Update to include ticket list
- Route: `/app/privacy` (existing)

**Admin Ticket Management**: `frontend/src/app/features/admin/privacy-requests/privacy-requests.component.ts`
- Route: `/app/admin/privacy-requests`
- Standalone page
- Lazy loaded

#### 7. Sidebar Navigation

**File**: `frontend/src/app/layouts/sidebar/sidebar.component.ts`

Add to `adminItems` array:
```typescript
{
  label: 'Privacy Requests',
  icon: 'privacy_tip',
  route: '/app/admin/privacy-requests',
  permission: 'privacy:tickets:read:all'
}
```

#### 8. Header Notification Bell

**File**: `frontend/src/app/layouts/header/header.component.ts`

Add to imports and template:
- Import `MatBadgeModule` and `MatBadge`
- Add notification bell icon with badge count
- Link to notification center or privacy requests

#### 9. Universal Notification System

**See**: `angular/docs/implementation-plans/NOTIFICATION_SYSTEM.md` for complete implementation details.

**Frontend Service**: `frontend/src/app/core/services/notification-center.service.ts`

**Backend**: `backend/src/modules/notifications/` module with entities and API

Notification types:
- New privacy ticket (admin)
- SLA warning approaching (admin)
- SLA breach (admin)
- Ticket status change (user)

### Phase 6: Documentation

- [ ] Complete privacy policy
- [ ] Complete terms of service
- [ ] Create internal procedures
- [ ] Add regional restrictions to policy

---

## Estimated Effort

| Phase | Documentation | Features | Total |
|-------|---------------|----------|-------|
| Phase 1: User Entity | 0 days | 0.5 days | 0.5 days |
| Phase 2: Backend | 0 days | 4 days | 4 days |
| Phase 3: Frontend | 0 days | 3 days | 3 days |
| Phase 4: Geo-Blocking | 0.25 days | 2 days | 2.25 days |
| Phase 5: Documentation | 2 days | 0 days | 2 days |
| **Total** | **2.25 days** | **9.5 days** | **~11.75 days** |

---

## Dependencies

- Working user authentication
- Existing account deletion
- geoip-lite (already in project)
- CAPTCHA system (already in project)
- RBAC/GBAC system (already in project)
- Notification bell icon in header
