# TASK-002: Remove Redundant Page Titles

## Description
Remove static `<h1>` headers from individual components since the dynamic page title is now globally visible in the application header.

## Implementation Steps
## Implementation Steps
Locate and remove the static `<h1>` or `<h2>` header tags from the following structured feature templates. Ensure any specific padding or margins assigned to the removed element (e.g. `.dashboard-title` or `.page-header h2`) are cleanly refactored out:

**Feature Views (`<h1>` removals):**
- `src/app/features/roles/roles.component.ts` 
- `src/app/features/groups/groups.component.ts` 
- `src/app/features/users/users.component.ts` 
- `src/app/features/users/create-user.component.ts` 
- `src/app/features/admin/users-management/users-list/users-list.component.html` 
- `src/app/features/dashboard/dashboard.component.html` 
- `src/app/features/tasks/tasks.component.html` 

**Admin Module Views (`<h2>` or `<h1>` target removals):**
- `src/app/modules/admin/login-monitoring/login-monitoring.component.html`
- `src/app/modules/admin/login-attempts/login-attempts.component.html`
- `src/app/modules/admin/pattern-detection/pattern-detection.component.html`
- `src/app/modules/admin/security-alerts/security-alerts.component.html`
- `src/app/modules/admin/ip-reputation/ip-reputation.component.html`

## Acceptance Criteria
- Components elegantly rely on the global header for their title.
- No duplicate visual titles (e.g., "Roles" in the header AND "Roles" in the page content).
- Ensure any CSS padding/margins associated specifically with the removed `<h1>` elements are cleaned up or adjusted so the layout doesn't break.
