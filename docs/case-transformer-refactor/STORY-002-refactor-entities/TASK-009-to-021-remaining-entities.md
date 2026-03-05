# TASK-009 through TASK-021: Remaining Entity Refactors

Each task below follows the same pattern: **remove** `name: 'snake_case'` from `@Column`, `@CreateDateColumn`, and `@UpdateDateColumn` decorators. **Keep** `name:` on `@JoinColumn`, `@JoinTable`, `@PrimaryColumn`, and `@Entity` decorators. Remove any backward-compatibility getter/setter pairs.

---

## TASK-009: group.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/group.entity.ts` (68 lines)

| Line | Before | After |
|------|--------|-------|
| 46 | `@Column({ name: 'is_system_group', default: false })` | `@Column({ default: false })` |
| 52 | `@Column({ name: 'owner_id', nullable: true })` | `@Column({ nullable: true })` |
| 59 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 62 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**DO NOT CHANGE**: Line 19 `@Entity('groups')`, line 56 `@JoinColumn({ name: 'owner_id' })`

---

## TASK-010: action.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/action.entity.ts` (65 lines)

| Line | Before | After |
|------|--------|-------|
| 38 | `@Column({ name: 'action_code', unique: true, length: 255 })` | `@Column({ unique: true, length: 255 })` |
| 59 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 62 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**DO NOT CHANGE**: Line 16 `@Entity('actions')`

---

## TASK-011: frontend-route.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/frontend-route.entity.ts` (145 lines)

| Line | Before | After |
|------|--------|-------|
| 54 | `@Column({ name: 'component_name', nullable: true, length: 255 })` | `@Column({ nullable: true, length: 255 })` |
| 78 | `@Column({ name: 'override_permissions', default: false })` | `@Column({ default: false })` |
| 85 | `@Column({ name: 'last_synced_at', nullable: true })` | `@Column({ nullable: true })` |
| 107 | `@Column({ name: 'is_disabled', default: false })` | `@Column({ default: false })` |
| 113 | `@Column({ name: 'show_in_menu', default: true })` | `@Column({ default: true })` |
| 125 | `@Column({ name: 'menu_order', default: 100 })` | `@Column({ default: 100 })` |
| 139 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 142 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**Remove getter/setter pairs:**
- Lines 22-36: `path` getter/setter (maps to `id`) — **Delete**
- Lines 57-71: `component` getter/setter (maps to `componentName`) — **Delete**
- Lines 88-102: `lastSynced` getter/setter (maps to `lastSyncedAt`) — **Delete**

**DO NOT CHANGE**: Line 17 `@Entity('frontend_routes')`, lines 132-136 `@JoinTable`

---

## TASK-012: api-endpoint.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/api-endpoint.entity.ts` (102 lines)

| Line | Before | After |
|------|--------|-------|
| 44 | `@Column({ name: 'controller_name', nullable: true, length: 100 })` | `@Column({ nullable: true, length: 100 })` |
| 51 | `@Column({ name: 'handler_name', nullable: true, length: 100 })` | `@Column({ nullable: true, length: 100 })` |
| 59 | `@Column({ name: 'override_permissions', default: false })` | `@Column({ default: false })` |
| 66 | `@Column({ name: 'last_synced_at', nullable: true })` | `@Column({ nullable: true })` |
| 96 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 99 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**Remove getter/setter pair:**
- Lines 69-83: `lastSynced` getter/setter — **Delete**

**DO NOT CHANGE**: Line 17 `@Entity('api_endpoints')`, lines 89-93 `@JoinTable`

---

## TASK-013: ui-component.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/ui-component.entity.ts` (79 lines)

| Line | Before | After |
|------|--------|-------|
| 40 | `@Column({ name: 'file_path', length: 255, nullable: true })` | `@Column({ length: 255, nullable: true })` |
| 51 | `@Column({ name: 'override_permissions', default: false })` | `@Column({ default: false })` |
| 54 | `@Column({ name: 'last_synced_at', nullable: true })` | `@Column({ nullable: true })` |
| 73 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 76 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**Remove getter/setter pairs:**
- Lines 21-35: `selector` getter/setter (maps to `id`) — **Delete**
- Lines 57-71: `lastSynced` getter/setter (maps to `lastSyncedAt`) — **Delete**

**DO NOT CHANGE**: Line 16 `@Entity('ui_components')`, lines 44-48 `@JoinTable`

---

## TASK-014: resource.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/resource.entity.ts` (40 lines)

| Line | Before | After |
|------|--------|-------|
| 30 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 33 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**DO NOT CHANGE**: Line 19 `@Entity('resources')`

---

## TASK-015: group-permission.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/group-permission.entity.ts` (74 lines)

| Line | Before | After |
|------|--------|-------|
| 29 | `@Column({ name: 'is_granted', default: true })` | `@Column({ default: true })` |
| 65 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 71 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**Remove getter/setter pair:**
- Lines 31-46: `granted` getter/setter — **Delete**

**DO NOT CHANGE**: Lines 19-20 `@PrimaryColumn({ name: ... })`, lines 52/59 `@JoinColumn({ name: ... })`

---

## TASK-016: user-permission.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/user-permission.entity.ts` (75 lines)

| Line | Before | After |
|------|--------|-------|
| 30 | `@Column({ name: 'is_granted', default: true })` | `@Column({ default: true })` |
| 66 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 72 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**Remove getter/setter pair:**
- Lines 32-47: `granted` getter/setter — **Delete**

**DO NOT CHANGE**: Lines 19-20 `@PrimaryColumn({ name: ... })`, lines 53/59 `@JoinColumn({ name: ... })`

---

## TASK-017: role.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/entities/role.entity.ts` (76 lines)

| Line | Before | After |
|------|--------|-------|
| 44 | `@Column({ default: false, name: 'is_system_role' })` | `@Column({ default: false })` |
| 47 | `@Column({ default: false, name: 'is_default' })` | `@Column({ default: false })` |
| 51 | `@Column({ nullable: true, name: 'parent_id' })` | `@Column({ nullable: true })` |
| 70 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 73 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**DO NOT CHANGE**: Line 33 `@Entity('roles')`, line 55 `@JoinColumn({ name: 'parent_id' })`

---

## TASK-018: role-permission.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/entities/role-permission.entity.ts` (62 lines)

| Line | Before | After |
|------|--------|-------|
| 29 | `@Column({ name: 'is_granted', default: true })` | `@Column({ default: true })` |
| 48 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 51 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**Remove getter/setter pair:**
- Lines 31-46: `granted` getter/setter — **Delete**

**DO NOT CHANGE**: Lines 20-21 `@PrimaryColumn({ name: ... })`, lines 55/59 `@JoinColumn({ name: ... })`

---

## TASK-019: cache-component.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/cache-entities/cache-component.entity.ts` (40 lines)

| Line | Before | After |
|------|--------|-------|
| 25 | `@Column({ name: 'file_path', length: 255, nullable: true })` | `@Column({ length: 255, nullable: true })` |
| 28 | `@Column({ name: 'last_synced_at', nullable: true })` | `@Column({ nullable: true })` |
| 34 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 37 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**DO NOT CHANGE**: Line 14 `@Entity('cache_components')`

---

## TASK-020: cache-endpoint.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/cache-entities/cache-endpoint.entity.ts` (48 lines)

| Line | Before | After |
|------|--------|-------|
| 30 | `@Column({ name: 'controller_name', length: 100, nullable: true })` | `@Column({ length: 100, nullable: true })` |
| 33 | `@Column({ name: 'handler_name', length: 100, nullable: true })` | `@Column({ length: 100, nullable: true })` |
| 36 | `@Column({ name: 'last_synced_at', nullable: true })` | `@Column({ nullable: true })` |
| 42 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 45 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**DO NOT CHANGE**: Line 15 `@Entity('cache_endpoints')`

---

## TASK-021: cache-route.entity.ts | Status: Completed

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/cache-entities/cache-route.entity.ts` (40 lines)

| Line | Before | After |
|------|--------|-------|
| 25 | `@Column({ name: 'component_name', length: 255, nullable: true })` | `@Column({ length: 255, nullable: true })` |
| 28 | `@Column({ name: 'last_synced_at', nullable: true })` | `@Column({ nullable: true })` |
| 34 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 37 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

**DO NOT CHANGE**: Line 14 `@Entity('cache_routes')`

---

## Acceptance Criteria (for ALL tasks above)

For each entity file:
- [ ] All `{ name: 'snake_case' }` removed from `@Column`, `@CreateDateColumn`, `@UpdateDateColumn` decorators
- [ ] All backward-compatibility getter/setter pairs removed (where specified)
- [ ] All `@Entity`, `@JoinColumn`, `@JoinTable`, `@PrimaryColumn` decorators left unchanged
- [ ] All TypeScript property names are unchanged (still camelCase)
- [ ] File compiles without errors
