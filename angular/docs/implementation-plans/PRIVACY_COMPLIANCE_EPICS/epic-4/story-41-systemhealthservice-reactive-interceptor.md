# Story 4.1: SystemHealthService & Reactive Interceptor
As a system, I want to monitor resources globally, so that the app doesn't crash during heavy I/O.
**Acceptance Criteria:**
- **Given** an API request to a heavy endpoint.
- **When** disk usage is >98% (Panic).
- **Then** the global interceptor must return a 503 error and halt the operation.
