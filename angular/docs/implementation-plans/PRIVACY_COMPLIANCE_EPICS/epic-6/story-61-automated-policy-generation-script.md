# Story 6.1: Automated Policy Generation Script
As a developer, I want my code to update the legal docs, so that the Privacy Policy is always accurate.
**Acceptance Criteria:**
- **Given** new @PrivacyProvider handlers.
- **When** npm run generate:privacy-policy is executed.
- **Then** it must re-assemble the global markdown from localized provider snippets (BOM-free).
