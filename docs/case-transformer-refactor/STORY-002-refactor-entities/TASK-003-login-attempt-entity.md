# TASK-003: Refactor login-attempt.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-003 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` parameters from column decorators and remove the `createdAt` getter/setter pair |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**File**: `angular/backend/src/modules/auth/entities/login-attempt.entity.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/entities/login-attempt.entity.ts`  
**Total Lines**: 62

---

## Edits

### Edit 1: Line 16 — Remove `name:` from ipAddress

**Before:** `@Column({ name: 'ip_address', type: 'text' })`  
**After:** `@Column({ type: 'text' })`

### Edit 2: Line 19 — Remove `name:` from userAgent

**Before:** `@Column({ name: 'user_agent', type: 'text' })`  
**After:** `@Column({ type: 'text' })`

### Edit 3: Line 22 — Remove `name:` from emailAttempted

**Before:** `@Column({ name: 'email_attempted', type: 'text', nullable: true })`  
**After:** `@Column({ type: 'text', nullable: true })`

### Edit 4: Line 37 — Remove `name:` from failureReason

**Before:** `@Column({ name: 'failure_reason', type: 'text', nullable: true })`  
**After:** `@Column({ type: 'text', nullable: true })`

### Edit 5: Line 43 — Remove `name:` from attemptedAt

**Before:** `@CreateDateColumn({ name: 'attempted_at', type: 'datetime' })`  
**After:** `@CreateDateColumn({ type: 'datetime' })`

### Edit 6: Lines 45-60 — Remove createdAt getter/setter

**Delete the entire block from line 45 to line 60 (inclusive)** — the `createdAt` getter/setter that maps to `attemptedAt`.

---

## DO NOT CHANGE

- Line 11: `@Entity('login_attempts')` — Keep the table name
- Line 34: `@JoinColumn({ name: 'user_id' })` — Keep the join column name

## Acceptance Criteria

- [ ] All `{ name: 'snake_case' }` removed from column decorators
- [ ] The `createdAt` getter/setter pair removed
- [ ] `@JoinColumn` decorator unchanged
- [ ] File compiles without errors
