# TASK-033: Fix roles.service.ts — Replace `.actionName` reference

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-033 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `Permission` entity's `actionName` getter was removed. Update `roles.service.ts` to use `permission.name`. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | TASK-008 must be completed |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts`

---

## Edits

### Edit 1: Lines 155-157 — Replace permission string construction

**Before (lines 155-157):**
```typescript
    const permissions = rolePermissions.map(
      (rp) => `${rp.permission.resourceName}:${rp.permission.actionName}`,
    );
```

**After:**
```typescript
    const permissions = rolePermissions.map((rp) => rp.permission.name);
```

---

## Acceptance Criteria

- [ ] `.actionName` reference replaced with `.name`
- [ ] File compiles without errors (`npx tsc --noEmit`)
