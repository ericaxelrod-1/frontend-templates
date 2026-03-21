# Global Privacy Regulations Reference

This document provides an overview of global privacy regulations relevant to this application.

---

## Documentation vs Features

| Type | Description | Included In |
|------|-------------|------------|
| **Documentation** | Privacy policy text, legal disclosures, internal policies | `docs/PRIVACY_COMPLIANCE.md` |
| **Features** | Code implementing functionality | Implementation plans |

See `angular/docs/implementation-plans/PRIVACY_COMPLIANCE.md` for complete feature vs documentation breakdown.

---

## Regulation Overview

| Regulation | Jurisdiction | Threshold | Key Difference |
|------------|--------------|-----------|---------------|
| **GDPR** | EU/EEA | Any EU resident data | Legal basis required, strict rights |
| **CCPA/CPRA** | California, USA | >$25M revenue OR >100K consumers OR 50%+ revenue from selling | Opt-out model for "sale/sharing" |
| **LGPD** | Brazil | Any Brazil resident data | 10 legal bases required |
| **PIPEDA** | Canada | Commercial activity | Consent-based |
| **Privacy Act** | Australia | >$3M turnover or government | APPs apply |

---

## Universal Rights (All Regulations)

| Right | GDPR | CCPA | LGPD | PIPEDA | Privacy Act |
|-------|------|------|------|--------|-------------|
| Access to data | Art 15 | Know | Access | Access | APP 11 |
| Correct inaccurate data | Art 16 | Correct | Correction | Accuracy | APP 12 |
| Delete data | Art 17 | Delete | Deletion | - | - |
| Data portability | Art 20 | Know | Portability | - | - |
| Object/Opt-out | Art 21 | Opt-out | Opposition | - | - |

---

## Regulation-Specific Requirements

### GDPR (European Union)

| Requirement | Type | Where Documented |
|-------------|------|------------------|
| Legal basis (Art 6) | Documentation | Privacy policy |
| Purpose (Art 13) | Documentation | Privacy policy |
| Retention (Art 13) | Documentation | Privacy policy |
| Third parties (Art 13) | Documentation | Privacy policy |
| Transfers (Chapter V) | Documentation | Privacy policy |
| Breach notification (Art 33/34) | Documentation | Privacy policy + procedures |
| Right of access (Art 15) | Feature | Implementation plan |
| Right to rectification (Art 16) | Feature | Existing PATCH endpoint |
| Right to erasure (Art 17) | Feature | Implementation plan |
| Right to restrict (Art 18) | Feature | Implementation plan |
| Right to portability (Art 20) | Feature | Implementation plan |
| Right to object (Art 21) | Feature | Implementation plan |
| Automated decisions (Art 22) | Feature | Implementation plan |

### CCPA/CPRA (California)

| Requirement | Type | Where Documented |
|-------------|------|------------------|
| "Do Not Sell" link | Feature | Implementation plan |
| Right to know | Feature | Implementation plan |
| Right to delete | Feature | Implementation plan |
| Right to correct | Feature | Existing PATCH endpoint |
| Right to opt-out | Feature | Implementation plan |
| Request verification | Feature | Logged-in users only |
| Response timeline | Documentation | Internal procedures |
| Sensitive PI controls | Documentation | Privacy policy (if applicable) |

### LGPD (Brazil)

| Requirement | Type | Where Documented |
|-------------|------|------------------|
| 10 Legal bases | Documentation | Privacy policy |
| Third-party disclosure | Documentation | Privacy policy |
| International transfers | Documentation | Privacy policy |
| Access | Feature | Implementation plan |
| Correction | Feature | Existing PATCH endpoint |
| Deletion/Anonymization | Feature | Implementation plan |
| Portability | Feature | Implementation plan |
| Consent management | Feature | Marketing opt-in |

### PIPEDA (Canada)

| Requirement | Type | Where Documented |
|-------------|------|------------------|
| Meaningful consent | Documentation | UI design guidelines |
| Purpose identification | Documentation | Privacy policy |
| Access | Feature | Implementation plan |
| Accuracy | Feature | Existing PATCH endpoint |

### Privacy Act (Australia)

| Requirement | Type | Where Documented |
|-------------|------|------------------|
| APP compliance checklist | Documentation | Privacy policy |
| APP 2 (Anonymity) | Documentation | Note: not available |
| APP 7 (Marketing) | Feature | Marketing opt-in |
| APP 8 (Cross-border) | Documentation | Privacy policy |
| Access (APP 11) | Feature | Implementation plan |
| Correction (APP 12) | Feature | Existing PATCH endpoint |

---

## Privacy Policy Requirements Summary

All regulations require a privacy policy. See `angular/docs/PRIVACY_COMPLIANCE.md` Section 2 for complete template.

### Required Privacy Policy Sections

| Section | All | GDPR | CCPA | LGPD | PIPEDA | Privacy Act |
|---------|-----|------|------|------|--------|-------------|
| Identity/Contact | ✅ | | | | | |
| Data We Collect | ✅ | | | | | |
| Legal Basis | | ✅ | | ✅ | | |
| Purpose | ✅ | | | | | |
| Retention | ✅ | | | | | |
| Third Parties | | | ✅ | ✅ | | |
| Transfers | | ✅ | | ✅ | | ✅ APP 8 |
| User Rights | ✅ | | | | | |
| Automated Decisions | | ✅ | | ✅ | | |
| Cookies | | ✅ | | | | |
| Children's Privacy | | ✅ | ✅ | | | |
| Breach Procedures | | ✅ | | | | |
| Regional Restrictions | ✅ | | | | | |

---

## Jurisdictional Determination

To determine which regulations apply:

1. **Do you have users in EU/EEA?** → GDPR applies
2. **Do you have users in California?** → CCPA applies (if thresholds met)
3. **Do you have users in Brazil?** → LGPD applies
4. **Do you have users in South Africa?** → POPIA applies
5. **Do you have users in Canada?** → PIPEDA may apply
6. **Do you have users in Australia?** → Privacy Act may apply

**If you have users in multiple jurisdictions, you must comply with ALL applicable regulations.**

---

## Implementation Approach

### For a Boilerplate Template

1. **Implement universal features**: These satisfy requirements across most regulations
   - Data export
   - Account deletion
   - Account correction
   - Marketing opt-in

2. **Implement regulation-specific features**: As needed
   - "Do Not Sell" toggle (CCPA)
   - Restriction toggles (GDPR)
   - Objection handling (GDPR)

3. **Document everything**: Privacy policy covers all regulations
   - Legal bases
   - Third-party disclosures
   - International transfers
   - Regional restrictions

4. **Block where needed**: Geo-blocking for jurisdictions without compliance
   - California (AB 1043)
   - Future: EU, Australia, etc.

---

## Regional Blocking

For jurisdictions where full compliance is not implemented, block users via geo-blocking.

See `angular/docs/implementation-plans/COUNTRY_REGION_BLOCKING.md`

| Region | Regulation | Blocking Approach |
|--------|-------------|-------------------|
| California (US-CA) | AB 1043 (2027) | Geo-block |
| EU (future) | GDPR | Geo-block or implement |
| Australia (future) | Privacy Act | Geo-block or implement |

---

## References

| Regulation | URL |
|------------|-----|
| GDPR | https://gdpr.eu/ |
| CCPA | https://oag.ca.gov/privacy/ccpa |
| LGPD | http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709.htm |
| POPIA | https://popia.co.za/ |
| PIPEDA | https://www.priv.gc.ca/en/privacy_privacy/ |
| Privacy Act (Australia) | https://www.oaic.gov.au/privacy/the-privacy-act |
| California AB 1043 | Digital Age Assurance Act (effective 2027) |
