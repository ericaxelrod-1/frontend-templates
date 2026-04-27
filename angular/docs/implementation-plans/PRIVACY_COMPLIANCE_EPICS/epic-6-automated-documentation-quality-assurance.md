# Epic 6: Automated Documentation & Quality Assurance

**Goal:** Ensure the system remains compliant, accessible, and documented via automated gates.

### Story 6.1: Automated Policy Generation Script
As a developer, I want my code to update the legal docs, so that the Privacy Policy is always accurate.
**Acceptance Criteria:**
- **Given** new @PrivacyProvider handlers.
- **When** npm run generate:privacy-policy is executed.
- **Then** it must re-assemble the global markdown from localized provider snippets (BOM-free).

### Story 6.2: Automated Accessibility & Performance Audits
As a system, I want to enforce standards in CI, so that the boilerplate remains WCAG 2.1 AA compliant.
**Acceptance Criteria:**
- **Given** the CI/CD pipeline.
- **When** privacy pages are modified.
- **Then** Lighthouse/axe-core audits must result in zero high-priority violations.
