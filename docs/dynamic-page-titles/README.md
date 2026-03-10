# Dynamic Page Titles Refactor

## Objective
Implement a robust, extensible `PageTitleService` to dynamically display the active view's name in the `HeaderComponent` next to the application logo. This improves user navigation and situational awareness, especially when determining context after scrolling.

## Current State
The `HeaderComponent` displays the static application name (`appName` from `AppConfigService`) but lacks context about the specific page the user is viewing. 

## End State
- A reactive `PageTitleService` using `BehaviorSubject` to broadcast the current title.
- `HeaderComponent` subscribes to the service and renders the dynamic title conditionally with a visual separator.
- Individual components (`RolesComponent`, `GroupsComponent`, `DashboardComponent`, etc.) inject the service to register their context locally during `ngOnInit` or upon data resolution.
- Standardized documentation across all user-facing views.

## Stories

### [STORY-001: PageTitleService Infrastructure](./STORY-001-page-title-service/README.md)
Create the core singleton `PageTitleService` and integrate its broadcast stream into the layout `HeaderComponent`.

### [STORY-002: Implementation Across Components](./STORY-002-implement-titles/README.md)
Inject the newly created service into various features, updating the title context dynamically across the application topology.
