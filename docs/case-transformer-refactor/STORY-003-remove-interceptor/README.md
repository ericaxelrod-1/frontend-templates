# STORY-003: Remove the CaseTransformInterceptor from the Frontend

> [!CAUTION]
> ## BLOCKING DEPENDENCY
> **NEVER** start any task in this story until STORY-002's TASK-035 (Final Verification) is complete and `npx tsc --noEmit` reports zero entity-refactoring-related errors. Starting this story before the backend compiles will make debugging significantly harder.

## Overview

With the `SnakeNamingStrategy` handling `camelCase` <-> `snake_case` mapping automatically, the frontend's `CaseTransformInterceptor` is no longer needed. This story removes it.

## Tasks

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | [TASK-001](./TASK-001-remove-interceptor-registration.md) | Remove interceptor registration from providers | Open |
| 2 | [TASK-002](./TASK-002-delete-interceptor-files.md) | Delete interceptor source files | Open |
| 3 | [TASK-003](./TASK-003-verify-frontend.md) | Verify frontend compiles and runs | Open |

> [!IMPORTANT]
> ## ALWAYS DO
> - **ALWAYS** verify the backend is compiling cleanly (STORY-002 TASK-035 complete) before starting this story
> - **ALWAYS** verify the frontend compiles after removing the interceptor (`ng build` or `ng serve`)
> - **ALWAYS** test at least one API call end-to-end to confirm data still maps correctly without the interceptor
