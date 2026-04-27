# Epic 3: Privacy Ticket System & Jurisdictional Resolution

**Goal:** Handle complex, non-verifiable, and jurisdictional requests automatically.

### Story 3.1: Public Request Page with CAPTCHA
As an anonymous user, I want to submit a request, so that I can exercise my rights without an account.
**Acceptance Criteria:**
- **Given** the public request route.
- **When** I submit the form.
- **Then** the system must validate the CAPTCHA and send a 24h magic link for status tracking.

### Story 3.2: Jurisdictional Resolver (Hierarchy Detection)
As a system, I want to assign the correct regulation to a ticket, so that SLAs are accurately tracked.
**Acceptance Criteria:**
- **Given** a new ticket submission.
- **When** detecting residency.
- **Then** it must follow the Profile > Declaration > IP hierarchy, defaulting to GDPR 30-day if unknown.
