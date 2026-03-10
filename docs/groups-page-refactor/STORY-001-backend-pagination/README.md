# STORY-001: Implement Backend Server-Side Pagination & Sorting

## Overview

Update the NestJS `GroupsController` and `GroupsService` to support standard server-side pagination, sorting, and searching. The endpoint must accept parameters for `page`, `pageSize`, `sortBy`, `sortDirection`, and `search`, and return a paginated response object instead of a flat array.

## Why This Must Be Done First

The frontend relies on these backend changes to properly implement its reactive table. Without these query parameters and the generic response structure in place, the frontend `mat-table` and `mat-paginator` cannot function correctly.

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | [TASK-001: Update GroupsService findAll](./TASK-001-update-groups-service.md) | Open |
| 2 | [TASK-002: Update GroupsController findAll](./TASK-002-update-groups-controller.md) | Open |
| 3 | [TASK-003: Verify Backend Response Format](./TASK-003-verify-backend.md) | Open |
