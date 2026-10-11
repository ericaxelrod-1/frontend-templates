---
classification:
  domain: legaltech
  projectType: web_app
  complexity: high
  innovation: incremental
stepsCompleted:
  - prd_initial_draft
  - prd_validation
  - prd_architectural_refinement
date: '2026-04-26'
---

# Privacy Compliance Implementation Plan

## Overview

This document defines the requirements for a global privacy compliance system (GDPR, CCPA, LGPD, etc.) designed as a robust, extensible boilerplate for future application development.

The goal is to provide a "Privacy-by-Design" foundation that scales with the application, ensuring that adding new data-handling services requires minimal effort to maintain compliance while protecting system resources via the "Sentinel" global monitoring system.

---

## Success Criteria

| Criterion | Metric | Measurement Method |
|-----------|--------|--------------------|
| **Statutory Compliance** | 100% adherence to GDPR/CCPA timelines | Automated SLA tracking in the Privacy Ticket System. |
| **Developer Ergonomics** | < 1 hour to add privacy support to a new service | Time-to-implement for a new `PrivacyProvider`. |
| **System Performance** | Zero impact on standard API hot-paths | Performance benchmarks showing no latency in non-privacy requests. |
| **Accessibility** | 100% WCAG 2.1 AA Compliance | Automated Lighthouse/axe-core audits on all privacy pages. |
| **System Resilience** | 0% crashes due to privacy-related resource leaks | Successful triggers of the "Sentinel" resource blocks during stress tests. |

---

## User Journeys

### 1. The Right to Access (Pavel)
*   **Goal:** Download all personal data.
*   **Flow:** Pavel logs in → Navigates to **Privacy Dashboard** → Clicks **Export Data** → Receives a notification when the background export job is complete → Downloads ZIP.

### 2. The Right to Erasure (Anne)
*   **Goal:** Delete account and receive proof of fulfillment.
*   **Flow:** Anne clicks **Delete Account** → System triggers a **Polymorphic Purge** → Account deactivated → Anne receives a **Digital Erasure Receipt** containing a non-PII cryptographic proof.

### 3. The Resource-Constrained Admin (Steve)
*   **Goal:** Resolve system health issues preventing compliance.
*   **Flow:** Steve receives a **Sentinel Alert** → Navigates to **System Health Dashboard** → Identifies low disk space → Performs maintenance via one-click cleanup tools.

---

## Functional Requirements

### 1. Core Data Rights (Self-Service)

| ID | Requirement | Description |
|----|-------------|-------------|
| **FR-001** | **Data Export** | User can request a complete export of their personal data. The system must process this as an asynchronous background job via a sequential Cron worker. |
| **FR-002** | **Account Deletion** | User can trigger account deletion. The system must coordinate a purge across all registered `PrivacyProviders` and issue a **Digital Signed Receipt** (Text/PDF). |
| **FR-003** | **Profile Update** | User can rectify personal information via a standard profile management interface. |
| **FR-004** | **Processing Restriction** | User can toggle restrictions on future data logging or processing (GDPR Art 18). |
| **FR-005** | **Processing Objection** | User can formally object to specific processing types via a structured form. |

### 2. Consent & Preference Management

| ID | Requirement | Description |
|----|-------------|-------------|
| **FR-006** | **Marketing Opt-In** | System must default to 'False' for marketing consent. User can explicitly opt-in via Profile Settings. |
| **FR-007** | **"Do Not Sell" Toggle** | California users (or all users) can opt-out of data selling/sharing via a top-level toggle. |
| **FR-008** | **Automated Policy Sync** | Developers can generate an updated Privacy Policy markdown via `npm run generate:privacy-policy` based on active code modules. |

### 3. Privacy Ticket System (Complex Requests)

| ID | Requirement | Description |
|----|-------------|-------------|
| **FR-009** | **Public Submission** | Anonymous users can submit privacy requests via a public form protected by CAPTCHA. |
| **FR-010** | **Magic Link Access** | Anonymous users receive a secure magic link to track the status of their ticket without an account. |
| **FR-011** | **Jurisdictional Resolver** | System must automatically determine the applicable regulation (GDPR vs CCPA) using a Resident Profile > Declaration > IP hierarchy. |
| **FR-012** | **SLA State Machine** | System must track statutory deadlines. **GDPR tickets** support "Pause" logic for `needs_info` states. **CCPA tickets** do NOT support pausing; they only allow for a one-time "Extension" state as per statute. |

### 4. System Health & Maintenance (The Sentinel)

| ID | Requirement | Description |
|----|-------------|-------------|
| **FR-013** | **System Health Dashboard** | Admins can view real-time resource stats (disk, memory) and job queue health via a dedicated route `/app/admin/system-health`. |
| **FR-014** | **Sidebar Integration** | A permanent link to **System Health** must be present in the admin sidebar with status-driven icons (Healthy/Warning/Critical). |
| **FR-015** | **Emergency Overrides** | Admins can use environment flags (`DISABLE_SENTINEL_GUARD`) to bypass resource blocks for disaster recovery. |

---

## Non-Functional Requirements

### 1. Performance & Scalability
*   **NFR-001 (Zero-Overhead):** Privacy logic must be decoupled from the standard request pipeline. Registration of providers occurs via startup discovery (NestJS `DiscoveryService`).
*   **NFR-002 (Asynchronicity):** All data-heavy tasks (Export/Purge) must run as isolated background jobs via a sequential Cron worker. The system must use **Database Streaming** to maintain a flat memory profile.

### 2. Security & Integrity
*   **NFR-003 (Immutable Audit):** All privacy rights exercises must be logged using **HMAC with a rotating global pepper** and multi-key support (`pepper_kid`).
*   **NFR-004 (Verification):** All public requests must pass email verification and CAPTCHA.
*   **NFR-005 (Resilient Bootstrap):** The system must warn and enter a "Degraded" security state if historical HMAC keys are missing, allowing the app to boot while flagging the audit gap.

### 3. Accessibility
*   **NFR-006 (WCAG Compliance):** All privacy-related UI components must meet WCAG 2.1 AA standards.

---

## Technical Architecture (Implementation Details)

### Backend Services
*   **SystemHealthService:** Global monitor for disk (90/95/98% thresholds) and memory.
*   **PrivacyRegistry:** Discovery-based service registry using the `@PrivacyProvider` decorator.
*   **UnifiedHousekeepingWorker:** A single cron-based worker for jobs, cleanup, and health heartbeats.

### Frontend Strategy
*   **Lazy Widget Dashboard:** A widget-based dashboard that hydrates state from the backend job queue using **NGXS Feature States**.
*   **System Health UI:** A dedicated route and sidebar entry for proactive monitoring.

---

## Implementation Tasks

- [x] **Phase 1:** User Entity Updates (Marketing/DNS flags)
- [x] **Phase 2:** Core Privacy Module & Registry Logic
- [ ] **Phase 3:** Privacy Ticket System (SLA Logic & Magic Links)
- [ ] **Phase 4:** Sentinel System (SystemHealthService & Maintenance Cron)
- [ ] **Phase 5:** Jurisdictional Resolver (Geo-IP + Profile mapping)
- [ ] **Phase 6:** System Health Frontend (Route & Sidebar Integration)
- [ ] **Phase 7:** Automated Policy Generation Script
- [ ] **Phase 8:** WCAG 2.1 AA Audit & Remediation

---

## Dependencies

- Working user authentication
- geoip-lite (IP-based jurisdiction)
- CAPTCHA system (Public spam prevention)
- RBAC/GBAC system (Admin ticket management)
- Notification system (User job updates)
- NGXS (State management)
