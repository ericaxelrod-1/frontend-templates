# Story 5.1: Multi-Key HMAC Pepper Rotation CLI
As an admin, I want to rotate encryption keys, so that my audit trail remains cryptographically strong.
**Acceptance Criteria:**
- **Given** the rotation script is run.
- **When** a new pepper is added.
- **Then** the script must pre-validate the ENV and update the DB KID tracking without breaking old logs.
