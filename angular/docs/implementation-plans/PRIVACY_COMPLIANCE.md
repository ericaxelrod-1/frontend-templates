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

## Implementation Tasks

### Phase 1: User Entity Updates

- [ ] Add `marketingConsent` field
- [ ] Add `doNotSell` field
- [ ] Add `consentUpdatedAt` timestamp

### Phase 2: Backend Features

- [ ] Create privacy module structure
- [ ] Implement export service
- [ ] Implement erasure service
- [ ] Add restriction toggles
- [ ] Add objection service
- [ ] Create support ticketing system

### Phase 3: Frontend Features

- [ ] Privacy dashboard component
- [ ] Data export dialog
- [ ] Delete account dialog
- [ ] Restriction toggles
- [ ] Marketing consent toggle
- [ ] "Do Not Sell" toggle
- [ ] Support ticket form

### Phase 4: Geo-Blocking

- [ ] Implement geo-block middleware
- [ ] Create blocked page
- [ ] Configure for California

### Phase 5: Documentation

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
- Support team (for ticketing)
