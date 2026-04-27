# Epic 2: Self-Service User Privacy Dashboard

**Goal:** Enable users to manage their data rights via a dynamic frontend dashboard.

### Story 2.1: Dashboard Layout & NGXS Hydration
As a user, I want a centralized dashboard, so that I can see my active privacy requests.
**Acceptance Criteria:**
- **Given** dashboard initialization.
- **When** the page loads.
- **Then** it must dispatch [Privacy UI] Fetch Active Tickets and hydrate widget states via NGXS.

### Story 2.2: Data Export Widget with Resource Guarding
As a user, I want to request my data, so that I can exercise my Right to Portability.
**Acceptance Criteria:**
- **Given** the dashboard is open.
- **When** I click 'Export'.
- **Then** the Sentinel must verify disk space (>95% usage blocks the request) before enqueuing the job.

### Story 2.3: "Dry Run" Preview Logic (onPreview)
As a user, I want to see what will be deleted, so that I can make an informed decision.
**Acceptance Criteria:**
- **Given** an account deletion request.
- **When** I view the confirmation.
- **Then** the UI must show a structured breakdown of record counts per data category.
