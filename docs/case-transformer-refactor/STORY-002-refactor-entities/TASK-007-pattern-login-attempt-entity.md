# TASK-007: Refactor pattern-login-attempt.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-007 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` from column decorators. Small entity with only 2 edits. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/entities/pattern-login-attempt.entity.ts`  
**Total Lines**: 36

## Edits

| Line | Before | After |
|------|--------|-------|
| 30 | `@Column({ name: 'is_primary_evidence', type: 'boolean', default: false })` | `@Column({ type: 'boolean', default: false })` |
| 33 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |

## DO NOT CHANGE
- Line 13: `@Entity('pattern_login_attempts')` — Keep table name
- Line 23: `@JoinColumn({ name: 'pattern_id' })` — Keep join column
- Line 27: `@JoinColumn({ name: 'login_attempt_id' })` — Keep join column

## Acceptance Criteria
- [ ] `name:` removed from `@Column` and `@CreateDateColumn` decorators
- [ ] All `@JoinColumn` decorators unchanged
- [ ] File compiles without errors
