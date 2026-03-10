# STORY-002: Refactor Frontend Groups Page Layout and Data Layer

## Overview

Update the frontend Groups features to consume the generic `ServerResponse<T>` paginated structure and display the data in a `mat-table` layout instead of a grid of `mat-card` elements. This redesign will align with `.cursor/rules/150-angular-server-side-sorting.mdc`.

## Why This Must Be Done Second

The backend pagination (STORY-001) must be in place before the frontend refactor. The UI assumes a standardized `items` and `total` schema to drive the `mat-table` and `mat-paginator`. Without the structure from the backend, this story cannot be completed or tested.

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | [TASK-001: Implement ServerResponse Model](./TASK-001-implement-server-response.md) | Open |
| 2 | [TASK-002: Refactor GroupService getGroups](./TASK-002-update-group-service.md) | Open |
| 3 | [TASK-003: Redesign Groups HTML Template](./TASK-003-redesign-groups-html.md) | Open |
| 4 | [TASK-004: Implement GroupsComponent Reactive Pattern](./TASK-004-implement-reactive-pattern.md) | Open |
| 5 | [TASK-005: Final UX and Functionality Verification](./TASK-005-verification.md) | Open |
