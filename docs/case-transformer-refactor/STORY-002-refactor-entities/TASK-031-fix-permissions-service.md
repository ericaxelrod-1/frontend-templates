# TASK-031: Fix permissions.service.ts — Replace `.actionName` and `.lastSynced` references

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-031 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `Permission` entity's `actionName` getter was removed. The `UiComponent`, `FrontendRoute`, and `ApiEndpoint` entities' `lastSynced` was renamed to `lastSyncedAt`. Update all references in `permissions.service.ts`. |
| **Estimated Effort** | 20 minutes |
| **Dependencies** | TASK-008, TASK-011, TASK-012, TASK-013 must be completed |

> [!IMPORTANT]
> This file has many edits. Work through them carefully one at a time. The `Permission` entity has a `name` field that stores `resource:action` as a single string. Use `permission.name` wherever a full permission string is needed, and `permission.actionEntity?.name` or `permission.name.split(':')[1]` wherever just the action name is needed.

> [!CAUTION]
> **NEVER** remove the `actionName` key from **response objects** that are returned to the frontend. Only change the **right-hand side** expression. The API contract must be preserved.

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/services/permissions.service.ts`

---

## Edits

### Group 1: Replace `` `${permission.resourceName}:${permission.actionName}` `` with `permission.name`

These lines construct a permission string from resource + action. The `name` field already stores this string.

| Line | Before | After |
|------|--------|-------|
| ~200 | `` const permString = `${permission.resourceName}:${permission.actionName}`; `` | `const permString = permission.name;` |
| ~218 | `` const permString = `${permission.resourceName}:${permission.actionName}`; `` | `const permString = permission.name;` |
| ~231 | `` const permString = `${permission.resourceName}:${permission.actionName}`; `` | `const permString = permission.name;` |

### Group 2: Replace `lastSynced` with `lastSyncedAt`

| Line | Before | After |
|------|--------|-------|
| ~288 | `component.lastSynced = new Date();` | `component.lastSyncedAt = new Date();` |
| ~333 | `route.lastSynced = new Date();` | `route.lastSyncedAt = new Date();` |
| ~428 | `endpoint.lastSynced = new Date();` | `endpoint.lastSyncedAt = new Date();` |

### Group 3: Replace `{ path }` with `{ id: path }` for FrontendRoute lookup

| Line | Before | After |
|------|--------|-------|
| ~358 | `where: { path },` | `where: { id: path },` |

### Group 4: Replace `` (p) => `${p.resourceName}:${p.actionName}` `` with `(p) => p.name`

| Line | Before | After |
|------|--------|-------|
| ~375 | `` (p) => `${p.resourceName}:${p.actionName}`, `` | `(p) => p.name,` |
| ~475 | `` (p) => `${p.resourceName}:${p.actionName}`, `` | `(p) => p.name,` |

### Group 5: Replace cache key `permission.actionName` with `permission.actionEntity?.name || ''`

| Line | Before | After |
|------|--------|-------|
| ~605 | `` this.cacheService.delete(`permissions:action:${permission.actionName}`); `` | `` this.cacheService.delete(`permissions:action:${permission.actionEntity?.name || ''}`); `` |
| ~651 | `` this.cacheService.delete(`permissions:action:${permission.actionName}`); `` | `` this.cacheService.delete(`permissions:action:${permission.actionEntity?.name || ''}`); `` |
| ~668 | `` this.cacheService.delete(`permissions:action:${permission.actionName}`); `` | `` this.cacheService.delete(`permissions:action:${permission.actionEntity?.name || ''}`); `` |

### Group 6: Replace `.actionName` in response objects (preserve the key, change the value)

| Line | Before | After |
|------|--------|-------|
| ~969 | `rp.permission.actionName === permission.actionName` | `rp.permission.name === permission.name` |
| ~1012 | `actionName: rp.permission.actionName,` | `actionName: rp.permission.name.split(':')[1] \|\| '',` |
| ~1099 | `actionName: gp.permission.actionName,` | `actionName: gp.permission.name.split(':')[1] \|\| '',` |
| ~1184 | `actionName: up.permission.actionName,` | `actionName: up.permission.name.split(':')[1] \|\| '',` |

---

## Acceptance Criteria

- [ ] All ~15 references to `.actionName` replaced
- [ ] All 3 references to `.lastSynced` replaced with `.lastSyncedAt`
- [ ] `{ path }` replaced with `{ id: path }` for `FrontendRoute` query
- [ ] API response keys like `actionName:` are preserved (only right-hand expressions changed)
- [ ] File compiles without errors (`npx tsc --noEmit`)
