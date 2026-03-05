# TASK-029: Fix endpoint-scanner.service.ts — Update removed property references

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-029 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `ApiEndpoint` entity's `lastSynced` alias was removed. The `Permission` entity's `actionName` was removed. Update `endpoint-scanner.service.ts`. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | TASK-008 and TASK-012 must be completed |

> [!IMPORTANT]
> **Property mapping reference:**
> | Old Alias | New Property |
> |-----------|-------------|
> | `ApiEndpoint.lastSynced` | `ApiEndpoint.lastSyncedAt` |
> | `Permission.actionName` | No longer exists — use `name` for lookups |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/scanners/endpoint-scanner.service.ts`

---

## Edits

### Edit 1: Line 200 — Change the create call to remove `id` assignment issue

**Before (lines 199-210):**
```typescript
        endpoint = this.endpointRepository.create({
          id: endpointId,
          method: httpMethod.toUpperCase(),
          path: fullPath,
          description,
          controllerName,
          handlerName: methodName,
          requiredPermissions: [],
          overridePermissions: false,
          lastSynced: new Date(),
        });
```

**After:**
```typescript
        endpoint = this.endpointRepository.create({
          id: endpointId,
          method: httpMethod.toUpperCase(),
          path: fullPath,
          description,
          controllerName,
          handlerName: methodName,
          requiredPermissions: [],
          overridePermissions: false,
          lastSyncedAt: new Date(),
        });
```

---

### Edit 2: Line 217 — Change `.lastSynced` to `.lastSyncedAt` in update

**Before (line 217):**
```typescript
          endpoint.lastSynced = new Date();
```

**After:**
```typescript
          endpoint.lastSyncedAt = new Date();
```

---

### Edit 3: Lines 229-241 — Replace `actionName` in Permission findOne and create

**Before (lines 229-241):**
```typescript
          let permission = await this.permissionRepository.findOne({
            where: { resourceName, actionName },
          });

          if (!permission) {
            permission = this.permissionRepository.create({
              resourceName,
              actionName,
              name: permString,
              description: `Permission required by ${httpMethod.toUpperCase()} ${fullPath}`,
            });
            await this.permissionRepository.save(permission);
          }
```

**After:**
```typescript
          let permission = await this.permissionRepository.findOne({
            where: { name: permString },
          });

          if (!permission) {
            permission = this.permissionRepository.create({
              resourceName,
              name: permString,
              description: `Permission required by ${httpMethod.toUpperCase()} ${fullPath}`,
            });
            await this.permissionRepository.save(permission);
          }
```

---

## Acceptance Criteria

- [ ] `.lastSynced` replaced with `.lastSyncedAt` on lines 209 and 217
- [ ] `actionName` removed from Permission `findOne` and `create` calls
- [ ] File compiles without errors (`npx tsc --noEmit`)
