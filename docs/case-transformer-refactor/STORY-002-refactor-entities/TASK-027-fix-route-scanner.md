# TASK-027: Fix route-scanner.service.ts — Update removed property references

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-027 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `FrontendRoute` entity's getter/setter aliases were removed (`.path`, `.component`, `.lastSynced`). The `Permission` entity's `actionName` was removed. Update `route-scanner.service.ts` to use canonical property names. |
| **Estimated Effort** | 15 minutes |
| **Dependencies** | TASK-008 and TASK-011 must be completed |

> [!IMPORTANT]
> **Property mapping reference:**
> | Old Alias | New Property |
> |-----------|-------------|
> | `FrontendRoute.path` | `FrontendRoute.id` (the PrimaryColumn) |
> | `FrontendRoute.component` | `FrontendRoute.componentName` |
> | `FrontendRoute.lastSynced` | `FrontendRoute.lastSyncedAt` |
> | `Permission.actionName` | No longer exists — use `actionId` for lookups |

> [!CAUTION]
> **NEVER** pass `actionName` to `permissionRepository.findOne({ where: ... })` or `permissionRepository.create(...)`. The `Permission` entity does NOT have an `actionName` column. Use `actionId` for queries, and `name` for the `resource:action` string.

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/scanners/route-scanner.service.ts`

---

## Edits

### Edit 1: Line 212 — Change `{ path }` to `{ id: path }` in findOne query

The `FrontendRoute` entity uses `id` as the primary column (which stores the path value). There is no separate `path` column.

**Before (line 212):**
```typescript
        let route = await this.routeRepository.findOne({ where: { path } });
```

**After:**
```typescript
        let route = await this.routeRepository.findOne({ where: { id: path } });
```

---

### Edit 2: Lines 215-223 — Change `.component` to `.componentName` and `.lastSynced` to `.lastSyncedAt` in create

**Before (lines 215-223):**
```typescript
          route = this.routeRepository.create({
            id: routeId,
            path,
            component: component || '',
            description: description || `Route: ${path}`,
            requiredPermissions: [],
            overridePermissions: false,
            lastSynced: new Date(),
          });
```

**After:**
```typescript
          route = this.routeRepository.create({
            id: routeId,
            componentName: component || '',
            description: description || `Route: ${path}`,
            requiredPermissions: [],
            overridePermissions: false,
            lastSyncedAt: new Date(),
          });
```

> [!NOTE]
> Removed the `path` property from the create call — `FrontendRoute` has no `path` column. The `id` column stores the path value.

---

### Edit 3: Lines 227-229 — Change `.component` to `.componentName` and `.lastSynced` to `.lastSyncedAt` in update

**Before (lines 227-229):**
```typescript
            route.component = component || route.component;
            route.description = description || route.description;
            route.lastSynced = new Date();
```

**After:**
```typescript
            route.componentName = component || route.componentName;
            route.description = description || route.description;
            route.lastSyncedAt = new Date();
```

---

### Edit 4: Lines 241-252 — Replace `actionName` in findOne and create for Permission

**Before (lines 241-252):**
```typescript
            let permission = await this.permissionRepository.findOne({
              where: { resourceName, actionName },
            });

            if (!permission) {
              permission = this.permissionRepository.create({
                resourceName,
                actionName,
                name: permString,
                description: `Permission required by route ${path}`,
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
                description: `Permission required by route ${path}`,
              });
              await this.permissionRepository.save(permission);
            }
```

> [!NOTE]
> Replaced `{ resourceName, actionName }` lookup with `{ name: permString }` since `name` is the unique `resource:action` string and `actionName` no longer exists on the entity.

---

## Acceptance Criteria

- [ ] `{ path }` replaced with `{ id: path }` on line 212
- [ ] `.component` replaced with `.componentName` on lines 218 and 227
- [ ] `.lastSynced` replaced with `.lastSyncedAt` on lines 222 and 229
- [ ] `actionName` removed from `findOne` and `create` calls for Permission
- [ ] `path` property removed from `routeRepository.create()` call
- [ ] File compiles without errors (`npx tsc --noEmit`)
