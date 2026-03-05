# TASK-032: Fix permission-checker.service.ts — Replace `.actionName` references

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-032 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `Permission` entity's `actionName` getter was removed. Update `permission-checker.service.ts` to use `permission.name`. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | TASK-008 must be completed |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/services/permission-checker.service.ts`

---

## Edits

All 3 edits follow the same pattern: replace the template literal that constructs `resource:action` with `permission.name`.

### Edit 1: Line ~104

**Before:**
```typescript
              const permString = `${permission.resourceName}:${permission.actionName}`;
```

**After:**
```typescript
              const permString = permission.name;
```

### Edit 2: Line ~122

**Before:**
```typescript
              const permString = `${permission.resourceName}:${permission.actionName}`;
```

**After:**
```typescript
              const permString = permission.name;
```

### Edit 3: Line ~135

**Before:**
```typescript
          const permString = `${permission.resourceName}:${permission.actionName}`;
```

**After:**
```typescript
          const permString = permission.name;
```

---

## Acceptance Criteria

- [ ] All 3 references to `.actionName` replaced with `.name`
- [ ] File compiles without errors (`npx tsc --noEmit`)
