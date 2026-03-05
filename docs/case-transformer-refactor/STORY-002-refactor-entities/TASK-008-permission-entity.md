# TASK-008: Refactor permission.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-008 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` from column decorators and remove the `actionName` getter/setter pair |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/entities/permission.entity.ts`  
**Total Lines**: 143

## Edits

| Line | Before | After |
|------|--------|-------|
| 49 | `@Column({ name: 'resource_name', length: 50 })` | `@Column({ length: 50 })` |
| 55 | `@Column({ name: 'action_id' })` | `@Column()` |
| 137 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 140 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

### Remove actionName getter/setter (lines 62-77)

**Delete lines 62-77 (inclusive):**
```typescript
  /**
   * Virtual column for backward compatibility with services expecting actionName
   * This maps to the Action entity's actionCode field for consistent lowercase permissions
   */
  get actionName(): string {
    return this.actionEntity?.actionCode || '';
  }

  /**
   * Setter for backward compatibility with services setting actionName
   * This is a no-op since actionName should be set via the Action relationship
   */
  set actionName(value: string) {
    // No-op: actionName should be set via the Action relationship
    // This setter exists only for backward compatibility
  }
```

## DO NOT CHANGE
- Line 25: `@Entity('permissions')` — Keep table name
- Line 59: `@JoinColumn({ name: 'action_id' })` — Keep join column
- Lines 113-120: `@JoinTable({ name: 'frontend_route_permissions', ... })` — Keep join table

## Acceptance Criteria
- [ ] `name:` removed from `@Column`, `@CreateDateColumn`, `@UpdateDateColumn`
- [ ] `actionName` getter/setter pair removed
- [ ] All `@JoinColumn` and `@JoinTable` decorators unchanged
- [ ] File compiles without errors
