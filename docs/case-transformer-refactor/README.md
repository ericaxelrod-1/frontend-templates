# Case Transformer Refactor

## Objective

Eliminate the `CaseTransformInterceptor` and replace it with TypeORM's `SnakeNamingStrategy`. This removes the asymmetric transformation layer between frontend and backend, eliminating the entire class of camelCase/snake_case bugs documented in the `homegrown-etl` project.

## End State

- Database columns remain snake_case (no database changes)
- All TypeScript code (backend + frontend) uses camelCase exclusively
- TypeORM automatically maps camelCase properties ↔ snake_case columns
- No frontend interceptor transforming responses
- No manual request transformations needed
- No backward-compatibility getter/setter pairs in entities

## Stories

| # | Story | Description | Status |
|---|-------|-------------|--------|
| 1 | [STORY-001](./STORY-001-install-naming-strategy/) | Install and configure TypeORM SnakeNamingStrategy | Open |
| 2 | [STORY-002](./STORY-002-refactor-entities/) | Refactor all entity files to remove explicit name mappings and getter/setter pairs | Open |
| 3 | [STORY-003](./STORY-003-remove-interceptor/) | Remove the CaseTransformInterceptor from the frontend | Open |

## Execution Order

Stories must be executed in order. STORY-001 must be completed and verified before STORY-002 begins. STORY-003 should be done last.

## Research Reference

See [interceptor_research.md](../../.gemini/antigravity/brain/5efbc23c-0e1f-4cb8-87ad-d5585008d80b/interceptor_research.md) for the full research report documenting all issues caused by the current interceptor pattern.
