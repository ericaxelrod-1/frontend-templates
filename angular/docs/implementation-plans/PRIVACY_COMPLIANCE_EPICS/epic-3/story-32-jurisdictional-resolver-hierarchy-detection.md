# Story 3.2: Jurisdictional Resolver (Hierarchy Detection)
As a system, I want to assign the correct regulation to a ticket, so that SLAs are accurately tracked.
**Acceptance Criteria:**
- **Given** a new ticket submission.
- **When** detecting residency.
- **Then** it must follow the Profile > Declaration > IP hierarchy, defaulting to GDPR 30-day if unknown.
