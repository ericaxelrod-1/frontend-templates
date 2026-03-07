# STORY-001: PageTitleService Infrastructure

## Objective
Establish the foundational infrastructure necessary to track and display dynamic page names across the angular routing bounds. 

## Requirements
- Create `PageTitleService` at `src/app/core/services/page-title.service.ts`.
- Service must expose a generic `setTitle(title: string)` method and a readonly reactive `title$` observable (`BehaviorSubject`).
- Inject the `PageTitleService` into `src/app/layouts/header/header.component.ts`.
- Modify `header.component.html` and `header.component.scss` to subscribe to the `title$` observable using the async pipe, displaying it alongside the `appName` with a vertical dividing pipe character (`|`) separating them (e.g., `App Name | Roles`).

## Tasks
* [TASK-001: Create PageTitleService](./TASK-001-create-service.md)
* [TASK-002: Update HeaderComponent](./TASK-002-update-header.md)
