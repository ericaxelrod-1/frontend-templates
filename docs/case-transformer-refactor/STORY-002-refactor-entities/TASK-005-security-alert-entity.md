# TASK-005: Refactor security-alert.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-005 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` parameters from `@Column`, `@CreateDateColumn`, `@UpdateDateColumn` decorators. No getter/setter pairs exist in this entity. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/entities/security-alert.entity.ts`  
**Total Lines**: 78

## Edits — Remove `name:` from these `@Column` decorators

| Line | Before | After |
|------|--------|-------|
| 18 | `@Column({ name: 'alert_type', length: 50 })` | `@Column({ length: 50 })` |
| 39 | `@Column({ name: 'ip_address', type: 'text', nullable: true })` | `@Column({ type: 'text', nullable: true })` |
| 49 | `@Column({ name: 'acknowledged_at', type: 'datetime', nullable: true })` | `@Column({ type: 'datetime', nullable: true })` |
| 56 | `@Column({ name: 'resolved_at', type: 'datetime', nullable: true })` | `@Column({ type: 'datetime', nullable: true })` |
| 63 | `@Column({ name: 'resolution_notes', type: 'text', nullable: true })` | `@Column({ type: 'text', nullable: true })` |
| 66 | `@Column({ name: 'alert_data', type: 'text', nullable: true })` | `@Column({ type: 'text', nullable: true })` |
| 69 | `@Column({ name: 'expires_at', type: 'datetime', nullable: true })` | `@Column({ type: 'datetime', nullable: true })` |
| 72 | `@CreateDateColumn({ name: 'created_at' })` | `@CreateDateColumn()` |
| 75 | `@UpdateDateColumn({ name: 'updated_at' })` | `@UpdateDateColumn()` |

## DO NOT CHANGE

- Line 13: `@Entity('security_alerts')` — Keep the table name
- Line 36: `@JoinColumn({ name: 'pattern_id' })` — Keep join column
- Line 43: `@JoinColumn({ name: 'user_id' })` — Keep join column
- Line 53: `@JoinColumn({ name: 'acknowledged_by' })` — Keep join column
- Line 60: `@JoinColumn({ name: 'resolved_by' })` — Keep join column

## Acceptance Criteria
- [ ] All `{ name: 'snake_case' }` removed from `@Column`, `@CreateDateColumn`, `@UpdateDateColumn`
- [ ] All `@JoinColumn` decorators unchanged
- [ ] File compiles without errors
