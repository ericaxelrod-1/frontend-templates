# TASK-028: Fix component-scanner.service.ts — Update removed property references

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-028 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `UiComponent` entity's getter/setter aliases were removed (`.selector`, `.lastSynced`). The `Permission` entity's `actionName` was removed. Update `component-scanner.service.ts`. |
| **Estimated Effort** | 15 minutes |
| **Dependencies** | TASK-008 and TASK-013 must be completed |

> [!IMPORTANT]
> **Property mapping reference:**
> | Old Alias | New Property |
> |-----------|-------------|
> | `UiComponent.selector` | `UiComponent.id` (the PrimaryColumn) |
> | `UiComponent.lastSynced` | `UiComponent.lastSyncedAt` |
> | `Permission.actionName` | No longer exists — use `name` for lookups |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/scanners/component-scanner.service.ts`

---

## Edits

### Edit 1: Line 183 — Change `{ selector }` to `{ id: selector }` in findOne query

**Before (line 183):**
```typescript
        where: { selector },
```

**After:**
```typescript
        where: { id: selector },
```

---

### Edit 2: Lines 187-194 — Change `selector` to `id` and `lastSynced` to `lastSyncedAt` in create

**Before (lines 187-194):**
```typescript
        component = this.componentRepository.create({
          selector,
          description: componentInfo.description,
          filePath: tsFile,
          requiredPermissions: [],
          overridePermissions: false,
          lastSynced: new Date(),
        });
```

**After:**
```typescript
        component = this.componentRepository.create({
          id: selector,
          description: componentInfo.description,
          filePath: tsFile,
          requiredPermissions: [],
          overridePermissions: false,
          lastSyncedAt: new Date(),
        });
```

---

### Edit 3: Line 200 — Change `.lastSynced` to `.lastSyncedAt` in update

**Before (line 200):**
```typescript
          component.lastSynced = new Date();
```

**After:**
```typescript
          component.lastSyncedAt = new Date();
```

---

### Edit 4: Lines 211-223 — Replace `actionName` in Permission findOne and create

**Before (lines 211-223):**
```typescript
          let permissionEntity = await this.permissionRepository.findOne({
            where: { resourceName, actionName },
          });

          if (!permissionEntity) {
            // Create the permission if it doesn't exist
            permissionEntity = this.permissionRepository.create({
              resourceName,
              actionName,
              name: permission,
              description: `Permission required by component ${selector}`,
            });
            await this.permissionRepository.save(permissionEntity);
          }
```

**After:**
```typescript
          let permissionEntity = await this.permissionRepository.findOne({
            where: { name: permission },
          });

          if (!permissionEntity) {
            // Create the permission if it doesn't exist
            permissionEntity = this.permissionRepository.create({
              resourceName,
              name: permission,
              description: `Permission required by component ${selector}`,
            });
            await this.permissionRepository.save(permissionEntity);
          }
```

---

## Acceptance Criteria

- [ ] `{ selector }` replaced with `{ id: selector }` on line 183
- [ ] `selector` replaced with `id: selector` in create call on line 188
- [ ] `.lastSynced` replaced with `.lastSyncedAt` on lines 193 and 200
- [ ] `actionName` removed from Permission `findOne` and `create` calls
- [ ] File compiles without errors (`npx tsc --noEmit`)
