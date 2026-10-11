# Story 5.2: Isolated Audit Log Implementation (No FKs)
As an auditor, I want a durable record of erasure, so that I can verify compliance after data is gone.
**Acceptance Criteria:**
- **Given** a fulfilled erasure request.
- **When** the audit log is saved.
- **Then** it must store the HMAC proof with NO foreign keys to the users table.
