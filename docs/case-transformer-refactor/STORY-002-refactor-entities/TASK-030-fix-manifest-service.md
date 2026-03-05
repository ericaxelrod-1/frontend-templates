# TASK-030: Fix manifest.service.ts — Replace `actionName` in Permission lookups

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-030 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `Permission` entity's `actionName` was removed in TASK-008. Update `manifest.service.ts` to use `name` for lookups. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | TASK-008 must be completed |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/scanners/manifest.service.ts`

---

## Edits

### Edit 1: Lines 201-213 — Replace `actionName` in Permission findOne and create

**Before (lines 201-213):**
```typescript
      let permission = await this.permissionRepo.findOne({
        where: { resourceName, actionName },
      });

      if (!permission) {
        // Create new permission
        permission = this.permissionRepo.create({
          resourceName,
          actionName,
          name: permString,
          description: `Permission for ${permString}`,
        });

        await this.permissionRepo.save(permission);
```

**After:**
```typescript
      let permission = await this.permissionRepo.findOne({
        where: { name: permString },
      });

      if (!permission) {
        // Create new permission
        permission = this.permissionRepo.create({
          resourceName,
          name: permString,
          description: `Permission for ${permString}`,
        });

        await this.permissionRepo.save(permission);
```

---

## Acceptance Criteria

- [ ] `{ resourceName, actionName }` replaced with `{ name: permString }` in findOne
- [ ] `actionName` removed from `create` call
- [ ] File compiles without errors (`npx tsc --noEmit`)
