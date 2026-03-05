# TASK-026: Fix actions.controller.ts — Replace `.actionName` with `.actionEntity?.actionCode`

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-026 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `Permission` entity's `actionName` getter was removed in TASK-008. Update `actions.controller.ts` to use `actionEntity?.actionCode` instead. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | TASK-008 must be completed |

> [!IMPORTANT]
> The `Permission` entity no longer has an `actionName` property. To get the action name string, use `permission.actionEntity?.actionCode || ''`. The `actionEntity` relationship is eager-loaded on the `Permission` entity, so it will be available.

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/actions.controller.ts`

---

## Edits

### Edit 1: Line 46 — Replace `.actionName` in `map()`

**Before (line 46):**
```typescript
    const uniqueActions = [...new Set(permissions.map((p) => p.actionName))];
```

**After:**
```typescript
    const uniqueActions = [...new Set(permissions.map((p) => p.actionEntity?.actionCode || ''))];
```

---

### Edit 2: Line 64 — Replace `.actionName` in `filter()`

**Before (line 64):**
```typescript
    const matchingPermissions = permissions.filter((p) => p.actionName === id);
```

**After:**
```typescript
    const matchingPermissions = permissions.filter((p) => (p.actionEntity?.actionCode || '') === id);
```

---

### Edit 3: Line 87 — Remove `actionName` from permission creation object

**Before (lines 85-90):**
```typescript
    const dummyPermission = await this.permissionsService.create({
      resourceName: 'system',
      actionName: createActionDto.name,
      description:
        createActionDto.description || `Action: ${createActionDto.name}`,
    });
```

**After:**
```typescript
    const dummyPermission = await this.permissionsService.create({
      resourceName: 'system',
      name: `system:${createActionDto.name}`,
      description:
        createActionDto.description || `Action: ${createActionDto.name}`,
    });
```

> [!NOTE]
> The `create` DTO may need `name` (the `resource:action` string) rather than a separate `actionName` field. Check what `permissionsService.create()` accepts. If it accepts an `actionName` field, leave it. If not, use `name: 'system:${createActionDto.name}'`.

---

### Edit 4: Line 112 — Replace `.actionName` in `filter()`

**Before (line 112):**
```typescript
    const matchingPermissions = permissions.filter((p) => p.actionName === id);
```

**After:**
```typescript
    const matchingPermissions = permissions.filter((p) => (p.actionEntity?.actionCode || '') === id);
```

---

### Edit 5: Line 136 — Replace `.actionName` in `filter()`

**Before (line 136):**
```typescript
    const matchingPermissions = permissions.filter((p) => p.actionName === id);
```

**After:**
```typescript
    const matchingPermissions = permissions.filter((p) => (p.actionEntity?.actionCode || '') === id);
```

---

## Acceptance Criteria

- [ ] All 5 references to `.actionName` replaced
- [ ] File compiles without errors (`npx tsc --noEmit`)
