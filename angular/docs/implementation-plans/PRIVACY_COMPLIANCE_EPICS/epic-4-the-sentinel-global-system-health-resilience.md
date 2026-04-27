# Epic 4: The Sentinel: Global System Health & Resilience

**Goal:** Protect the system from resource exhaustion and provide admin recovery tools.

### Story 4.1: SystemHealthService & Reactive Interceptor
As a system, I want to monitor resources globally, so that the app doesn't crash during heavy I/O.
**Acceptance Criteria:**
- **Given** an API request to a heavy endpoint.
- **When** disk usage is >98% (Panic).
- **Then** the global interceptor must return a 503 error and halt the operation.

### Story 4.2: Sidebar Integration & Status Icons
As an admin, I want to see system health at a glance, so that I can proactively manage storage.
**Acceptance Criteria:**
- **Given** the admin sidebar.
- **When** health status changes.
- **Then** the sidebar icon must reactively update its color based on the Sentinel's state.
