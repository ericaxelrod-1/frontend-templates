# TASK-001: Update Key Components

## Description
Inject the `PageTitleService` into primary routing endpoints to populate the header title dynamically.

## Implementation Steps
For each of the following components, inject the `PageTitleService` in the constructor and call `this.pageTitleService.setTitle('Component Name');` during the `ngOnInit` lifecycle hook.

### Targeted Components

**Feature Views:**
- `src/app/features/roles/roles.component.ts` -> Set title to `'Roles'`
- `src/app/features/groups/groups.component.ts` -> Set title to `'Groups'`
- `src/app/features/users/users.component.ts` -> Set title to `'Users'`
- `src/app/features/users/create-user.component.ts` -> Set title to `'Create User'`
- `src/app/features/admin/users-management/users-list/users-list.component.ts` -> Set title to `'User Management'`
- `src/app/features/dashboard/dashboard.component.ts` -> Set title to `'Dashboard'`
- `src/app/features/tasks/tasks.component.ts` -> Set title to `'Tasks'`

**Admin Module Views:**
- `src/app/modules/admin/login-monitoring/login-monitoring.component.ts` -> Set title to `'Login Monitoring'`
- `src/app/modules/admin/login-attempts/login-attempts.component.ts` -> Set title to `'Login Attempts'`
- `src/app/modules/admin/pattern-detection/pattern-detection.component.ts` -> Set title to `'Pattern Detection'`
- `src/app/modules/admin/security-alerts/security-alerts.component.ts` -> Set title to `'Security Alerts'`
- `src/app/modules/admin/ip-reputation/ip-reputation.component.ts` -> Set title to `'IP Reputation'`

## Acceptance Criteria
- Navigating to `/app/roles` updates the top header bar to state "App Name | Roles".
- Context cleanly switches uniformly when traversing standard Angular routing links.
