# BUG-002: Sidebar Overlay Refactor — CDK Overlay Migration

## Problem

All sidebar overlay components use raw CSS `position: fixed` inside `mat-sidenav-content`. Angular Material's sidenav container applies `transform` during animations, which creates a **containing block** that traps fixed-position elements. These sidebars cannot render above layout-level elements (header, footer), making their action buttons unclickable. The user-sidebar also has focus management issues for the same reason — no CDK focus trapping.

## Root Cause

Using `position: fixed` + custom backdrop CSS instead of Angular CDK Overlay. CDK Overlay renders content into a dedicated container appended to `<body>`, completely outside any stacking context. It also provides built-in backdrop, focus trapping, keyboard handling (Escape to close), and proper accessibility.

## Approach

Create a reusable `SidePanel` service (modeled after `MatDialog` / `MatBottomSheet`) that wraps CDK Overlay. Each existing sidebar component becomes a "panel content" component opened via the service. This eliminates all custom `position: fixed` CSS, z-index management, and backdrop handling.

## Architecture

```
SidePanelService (new)
├── Uses CDK Overlay to create right-edge panel
├── Opens a ComponentType with data injection
├── Returns SidePanelRef for close/result communication
├── Handles backdrop, focus trap, Escape key, animations
│
├── GroupSelectorPanelComponent (refactored from group-selector-sidebar)
├── RoleSelectorPanelComponent (refactored from role-selector-sidebar)
├── RoleCreationPanelComponent (refactored from role-creation-sidebar)
├── GroupCreationPanelComponent (refactored from group-creation-sidebar)
├── MemberActionsPanelComponent (refactored from member-actions-sidebar)
├── UserSelectorPanelComponent (refactored from user-selector-sidebar + generic-selector-sidebar)
└── UserProfilePanelComponent (refactored from user-sidebar)
```

## Affected Components

| # | Current Component | Page | Refactor To |
|---|---|---|---|
| 1 | group-selector-sidebar | Create User | Panel opened via SidePanelService |
| 2 | role-selector-sidebar | Create User | Panel opened via SidePanelService |
| 3 | role-creation-sidebar | Roles | Panel opened via SidePanelService |
| 4 | group-creation-sidebar | Groups | Panel opened via SidePanelService |
| 5 | member-actions-sidebar | Groups | Panel opened via SidePanelService |
| 6 | generic-selector-sidebar + user-selector-sidebar | Groups | Panel opened via SidePanelService |
| 7 | user-sidebar (layout) | All pages (header) | Panel opened via SidePanelService |

## Stories

| # | Story | Description | Status |
|---|-------|-------------|--------|
| 1 | [STORY-001](./STORY-001-create-side-panel-service/) | Create the SidePanelService, SidePanelRef, and injection token infrastructure | Open |
| 2 | [STORY-002](./STORY-002-refactor-sidebar-components/) | Refactor all 7 sidebar components to use SidePanelService | Open |
| 3 | [STORY-003](./STORY-003-cleanup/) | Remove old position:fixed CSS, z-index workarounds, and unused files | Open |

## Execution Order

Stories must be executed in order. STORY-001 creates the infrastructure that STORY-002 depends on. STORY-003 cleans up after STORY-002 is verified.

## Reference

- Angular CDK Overlay docs: https://material.angular.io/cdk/overlay/overview
- Angular CDK Portal docs: https://material.angular.io/cdk/portal/overview
- `MatDialog` source (reference implementation): uses CDK Overlay to create modal panels
- `MatBottomSheet` source (reference implementation): uses CDK Overlay to create slide-up panels
- Existing CDK Overlay usage in this project: `shared/directives/mat-select-fix.directive.ts`, `shared/directives/mat-menu-fix.directive.ts`
