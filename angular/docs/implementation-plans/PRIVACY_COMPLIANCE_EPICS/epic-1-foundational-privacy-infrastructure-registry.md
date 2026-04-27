# Epic 1: Foundational Privacy Infrastructure & Registry

**Goal:** Establish the core registry and sequential worker loop to enable future privacy handlers.

## Story 1.1: Privacy Registry Core & @PrivacyProvider Decorator
As a developer, I want a standard way to register privacy handlers, so that the system can discover them without circular imports.
**Acceptance Criteria:**
- **Given** the backend is starting up.
- **When** a service uses @PrivacyProvider and resides in a feature folder.
- **Then** NestJS DiscoveryService must register it and verify IPrivacyProvider contract compliance.

## Story 1.2: Privacy Job Table & Atomic Locking
As an admin, I want requests tracked in a persistent table, so that the single-instance backend handles them sequentially.
**Acceptance Criteria:**
- **Given** database initialization.
- **When** the privacy_jobs table is created.
- **Then** it must support status tracking and atomic 'locked_at' logic for idempotency.

## Story 1.3: Sequential Housekeeping Worker (Cron)
As a system, I want to process jobs via a scheduled loop, so that memory footprint remains minimal.
**Acceptance Criteria:**
- **Given** pending jobs in the DB.
- **When** the cron triggers every 5 mins.
- **Then** jobs are processed one-by-one with a batch limit of 5 and per-service timeouts.
