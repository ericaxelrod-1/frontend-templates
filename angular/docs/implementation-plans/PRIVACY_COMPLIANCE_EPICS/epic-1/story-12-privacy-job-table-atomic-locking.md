# Story 1.2: Privacy Job Table & Atomic Locking
As an admin, I want requests tracked in a persistent table, so that the single-instance backend handles them sequentially.
**Acceptance Criteria:**
- **Given** database initialization.
- **When** the privacy_jobs table is created.
- **Then** it must support status tracking and atomic 'locked_at' logic for idempotency.
