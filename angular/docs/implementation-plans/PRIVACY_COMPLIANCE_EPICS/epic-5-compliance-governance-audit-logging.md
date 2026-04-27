# Epic 5: Compliance Governance & Audit Logging

**Goal:** Maintain an immutable record of compliance to satisfy legal audits.

### Story 5.1: Multi-Key HMAC Pepper Rotation CLI
As an admin, I want to rotate encryption keys, so that my audit trail remains cryptographically strong.
**Acceptance Criteria:**
- **Given** the rotation script is run.
- **When** a new pepper is added.
- **Then** the script must pre-validate the ENV and update the DB KID tracking without breaking old logs.

### Story 5.2: Isolated Audit Log Implementation (No FKs)
As an auditor, I want a durable record of erasure, so that I can verify compliance after data is gone.
**Acceptance Criteria:**
- **Given** a fulfilled erasure request.
- **When** the audit log is saved.
- **Then** it must store the HMAC proof with NO foreign keys to the users table.
