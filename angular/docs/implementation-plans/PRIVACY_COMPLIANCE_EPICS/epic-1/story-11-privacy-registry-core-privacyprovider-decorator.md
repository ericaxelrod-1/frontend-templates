# Story 1.1: Privacy Registry Core & @PrivacyProvider Decorator
As a developer, I want a standard way to register privacy handlers, so that the system can discover them without circular imports.
**Acceptance Criteria:**
- **Given** the backend is starting up.
- **When** a service uses @PrivacyProvider and resides in a feature folder.
- **Then** NestJS DiscoveryService must register it and verify IPrivacyProvider contract compliance.
