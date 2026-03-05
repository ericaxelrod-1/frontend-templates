# TASK-006: Refactor security-detected-pattern.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-006 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` parameters from column decorators. No getter/setter pairs. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/entities/security-detected-pattern.entity.ts`  
**Total Lines**: 83

## Edits — Remove `name:` from these decorators

| Line | Before | After |
|------|--------|-------|
| 20 | `@Column({ name: 'pattern_type', length: 50 })` | `@Column({ length: 50 })` |
| 26 | `@Column({ name: 'ip_address', type: 'text' })` | `@Column({ type: 'text' })` |
| 29-33 | `@Column({ name: 'detection_timestamp', type: 'datetime', default: () => "datetime('now')" })` | `@Column({ type: 'datetime', default: () => "datetime('now')" })` |
| 36 | `@Column({ name: 'time_window_start', type: 'datetime' })` | `@Column({ type: 'datetime' })` |
| 39 | `@Column({ name: 'time_window_end', type: 'datetime' })` | `@Column({ type: 'datetime' })` |
| 42 | `@Column({ name: 'attempt_count', type: 'integer', default: 0 })` | `@Column({ type: 'integer', default: 0 })` |
| 45 | `@Column({ name: 'unique_email_count', type: 'integer', default: 0 })` | `@Column({ type: 'integer', default: 0 })` |
| 54 | `@Column({ name: 'resolved_at', type: 'datetime', nullable: true })` | `@Column({ type: 'datetime', nullable: true })` |
| 61 | `@Column({ name: 'resolution_notes', type: 'text', nullable: true })` | `@Column({ type: 'text', nullable: true })` |
| 67 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 70 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

## DO NOT CHANGE
- Line 15: `@Entity('security_detected_patterns')` — Keep table name
- Line 58: `@JoinColumn({ name: 'resolved_by' })` — Keep join column

## Acceptance Criteria
- [ ] All `{ name: 'snake_case' }` removed from column decorators
- [ ] All `@JoinColumn` decorators unchanged
- [ ] File compiles without errors
