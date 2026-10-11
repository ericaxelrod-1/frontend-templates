# Story 2.2: Data Export Widget with Resource Guarding
As a user, I want to request my data, so that I can exercise my Right to Portability.
**Acceptance Criteria:**
- **Given** the dashboard is open.
- **When** I click 'Export'.
- **Then** the Sentinel must verify disk space (>95% usage blocks the request) before enqueuing the job.
