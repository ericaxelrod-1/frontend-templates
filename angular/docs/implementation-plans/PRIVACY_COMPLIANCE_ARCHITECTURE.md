---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-04-26'
inputDocuments:
  - angular/docs/implementation-plans/PRIVACY_COMPLIANCE.md
  - angular/docs/implementation-plans/COUNTRY_REGION_BLOCKING.md
  - angular/docs/implementation-plans/EMAIL_SERVICE.md
  - angular/docs/implementation-plans/NOTIFICATION_SYSTEM.md
  - angular/docs/implementation-plans/TYPEORM_RLS_LIBRARY.md
  - FIREBASE_AI_CONTEXT.md
project_name: 'Signet Frontend Boilerplate'
user_name: 'Axel'
date: 'Sunday, April 26, 2026'
---

# Architecture Decision Document: Privacy & Sentinel System

## Project Context Analysis

### Requirements Overview
The Privacy Compliance system requires a "Privacy-by-Design" architecture that is high-performance, extensible via a decorator-based registry, and resilient to resource exhaustion.

**Key Technical Pillars:**
- **Polymorphic Registry:** Uses NestJS `DiscoveryService` to avoid circular dependencies.
- **Sentinel Monitoring:** Global `SystemHealthService` to protect the single-instance backend.
- **Database-Native Queue:** Sequential processing via a unified housekeeping Cron.
- **HMAC Audit Trail:** Multi-key support for seamless rotation and strong anonymization.

---

## Architectural Decisions (ADRs)

### ADR-001: Polymorphic Discovery Registry
**Decision:** Use `@PrivacyProvider` decorator + NestJS `DiscoveryService`.
**Rationale:** Decouples core Privacy module from feature modules, preventing circular imports.

### ADR-002: Database-as-a-Queue (Sequential Cron)
**Decision:** Use a `privacy_jobs` table + unified `@Cron('*/5 * * * *')` housekeeping loop.
**Rationale:** Removes need for Redis/BullMQ. Ensures flat memory usage via sequential execution and database streaming.

### ADR-003: Sentinel Global Resource Guard
**Decision:** `SystemHealthService` with reactive thresholds: 90% (Warn), 95% (Block Exports), 98% (Panic/Block All Writes).
**Rationale:** Provides a global safety gate for all heavy application tasks.

### ADR-004: Multi-Key HMAC Audit Log
**Decision:** `HMAC(userId, pepper)` with `pepper_kid` tracking and dual-key support (`CURRENT`/`PREVIOUS`).
**Rationale:** Supports zero-downtime key rotation and prevents re-identification attacks.

### ADR-005: NGXS Feature State for Job Hydration
**Decision:** Use `NGXS_FEATURE_MODULE` to inject `PrivacyState`.
**Rationale:** Aligns with existing project patterns and ensures consistent "Processing" states across dashboard widgets.

### ADR-006: Identity Verification & SLA Clock Pausing
**Decision:** Unauthenticated privacy requests enter a "Pending Verification" state via Magic Link, pausing the SLA clock. Unverified requests are automatically hard-deleted after 24 hours.
**Rationale:** 
- **Legal Mandate:** GDPR (Art 12(6)) and CCPA/CPRA require identity verification ("verifiable consumer request"). Fulfilling unverified requests risks a data breach.
- **SLA Clock:** The 30-day (GDPR) or 45-day (CCPA) statutory clock does not begin (or is paused) until the user clicks the verification link.
- **Data Minimization:** Retaining unverified email addresses indefinitely violates data minimization principles and opens the system to malicious bot spam. A 24-hour expiration followed by a scheduled hard-delete prevents this.

---

## Implementation Patterns & Consistency Rules

### Naming Conventions
- **Files:** Mandatory `.privacy.ts` suffix for all handlers (e.g., `user.privacy.ts`).
- **NGXS Actions:** Strict category prefixing: `[Privacy Job]` for background tasks, `[Privacy UI]` for interactions.
- **Classes:** `PascalCase` (e.g., `PrivacyRegistryService`).
- **DB Tables:** Plural `snake_case` (e.g., `privacy_audit_logs`).

### Structure Patterns
- **Provider Location:** Handlers MUST live in their respective feature folders (e.g., `modules/billing/privacy/`).
- **Core Logic:** Global privacy services live in `backend/src/modules/privacy/`.
- **Contracts:** Shared interfaces live in `backend/src/common/contracts/privacy/`.

### Process Patterns
- **Minimal Memory:** `onExport` MUST return a `ReadableStream` to maintain a constant memory ceiling.
- **Resilient Bootstrap:** "Warn-and-Degrade" logic for missing historical keys (Non-blocking boot).
- **Error Handling:** Catch provider errors and return standardized user-friendly messages (e.g., "Partial success: records pending review").

---

## Project Structure & Boundaries

### 1. Database Schema (Phase 1)

**New Table: `privacy_tickets`**
- `id`: primary_key
- `request_type`: enum (export, erasure, etc.)
- `status`: enum (pending, in_review, completed, failed)
- `user_id`: fk (users.id, nullable)
- `email`: string (nullable)
- `regulation`: enum (gdpr, ccpa, other)
- `sla_deadline`: datetime
- `accrued_paused_time`: integer (ms)
- `created_at`: datetime

**New Table: `privacy_jobs`**
- `id`: primary_key
- `ticket_id`: fk (privacy_tickets.id)
- `status`: enum (pending, processing, completed, failed)
- `provider_results`: jsonb (tracking per-service success)
- `locked_at`: datetime (nullable)
- `error_log`: text (nullable)

**New Table: `privacy_audit_logs`**
- `id`: primary_key
- `action_type`: enum (export, erasure)
- `hmac_proof`: string (anonymized user hash)
- `pepper_kid`: string (key identifier)
- `fulfilled_at`: datetime
- *Constraint: No foreign keys to any user-related tables.*

---

## Architecture Validation Results

### Coherence Validation ✅
- **Decision Compatibility:** NestJS 11 + TypeORM 0.3.23 + Angular 18 are fully compatible. Database-native queue removes all external infrastructure conflicts.
- **Pattern Consistency:** Established `snake_case` (DB) to `camelCase` (API) mapping provides consistent contract handling.
- **Structure Alignment:** Feature-isolated `.privacy.ts` structure supports the Discovery-based registry perfectly.

### Requirements Coverage Validation ✅
- **Functional:** 100% of FR-001 through FR-015 are mapped to specific backend/frontend components.
- **Non-Functional:** Performance (Streaming), Security (HMAC), and Resilience (Sentinel) are natively integrated into the core services.

### Implementation Readiness Validation ✅
- **Confidence Level:** High.
- **Overall Status:** READY FOR IMPLEMENTATION.

---

## Implementation Handoff

### AI Agent Guidelines:
- **Zero-Deps:** Do NOT add Redis, BullMQ, or any new external infrastructure.
- **IoC-First:** Use `@PrivacyProvider` and NestJS `DiscoveryService`; NEVER import feature modules into the `PrivacyModule`.
- **Stream-First:** `onExport` must return a stream to maintain the flat memory footprint requirement.
- **Phase Sequence:** Phase 1 (Database) -> Phase 2 (Backend Core) -> Phase 3 (Feature Handlers) -> Phase 4 (Frontend).

### First Implementation Priority:
- **Task:** Create the Database Migrations for `privacy_tickets`, `privacy_jobs`, and `privacy_audit_logs`.
