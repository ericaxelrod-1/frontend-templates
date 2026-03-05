# TASK-004: Refactor ip-reputation.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-004 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` parameters from column decorators and remove 4 backward-compatibility getter/setter pairs |
| **Estimated Effort** | 15 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**File**: `angular/backend/src/modules/auth/entities/ip-reputation.entity.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/entities/ip-reputation.entity.ts`  
**Total Lines**: 120

---

## Edits

### Edit 1: Line 14 — Remove `name:` from ipAddress
**Before:** `@Column({ name: 'ip_address', type: 'text', unique: true })`  
**After:** `@Column({ type: 'text', unique: true })`

### Edit 2: Line 17 — Remove `name:` from status
**Before:** `@Column({ name: 'status', type: 'text', default: 'unknown' })`  
**After:** `@Column({ type: 'text', default: 'unknown' })`

### Edit 3: Line 20 — Remove `name:` from reputationScore
**Before:** `@Column({ name: 'reputation_score', type: 'integer', default: 100 })`  
**After:** `@Column({ type: 'integer', default: 100 })`

### Edit 4: Line 23 — Remove `name:` from geoLocationInfo
**Before:** `@Column({ name: 'geo_location_info', type: 'text', nullable: true })`  
**After:** `@Column({ type: 'text', nullable: true })`

### Edit 5: Line 26 — Remove `name:` from accessStatistics
**Before:** `@Column({ name: 'access_statistics', type: 'text', nullable: true })`  
**After:** `@Column({ type: 'text', nullable: true })`

### Edit 6: Line 29 — Remove `name:` from blockHistory
**Before:** `@Column({ name: 'block_history', type: 'text', nullable: true })`  
**After:** `@Column({ type: 'text', nullable: true })`

### Edit 7: Line 32 — Remove `name:` from failedLoginAttempts
**Before:** `@Column({ name: 'failed_login_attempts', type: 'integer', default: 0 })`  
**After:** `@Column({ type: 'integer', default: 0 })`

### Edit 8: Lines 34-49 — Remove failedAttempts getter/setter
**Delete lines 34-49 (inclusive).**

### Edit 9: Line 51 — Remove `name:` from isManuallyBlocked
**Before:** `@Column({ name: 'is_manually_blocked', type: 'boolean', default: false })`  
**After:** `@Column({ type: 'boolean', default: false })`

### Edit 10: Lines 53-71 — Remove isBlocked getter/setter
**Delete lines 53-71 (inclusive).**

### Edit 11: Line 73 — Remove `name:` from blockedUntilAuto
**Before:** `@Column({ name: 'blocked_until_auto', type: 'datetime', nullable: true })`  
**After:** `@Column({ type: 'datetime', nullable: true })`

### Edit 12: Lines 75-90 — Remove blockedUntil getter/setter
**Delete lines 75-90 (inclusive).**

### Edit 13: Line 92 — Remove `name:` from captchaChallengeCount
**Before:** `@Column({ name: 'captcha_challenge_count', type: 'integer', default: 0 })`  
**After:** `@Column({ type: 'integer', default: 0 })`

### Edit 14: Lines 94-109 — Remove captchaRequiredCount getter/setter
**Delete lines 94-109 (inclusive).**

### Edit 15: Line 111 — Remove `name:` from notes
**Before:** `@Column({ name: 'notes', type: 'text', nullable: true })`  
**After:** `@Column({ type: 'text', nullable: true })`

### Edit 16: Line 114 — Remove `name:` from firstSeenAt
**Before:** `@CreateDateColumn({ name: 'first_seen_at', type: 'datetime' })`  
**After:** `@CreateDateColumn({ type: 'datetime' })`

### Edit 17: Line 117 — Remove `name:` from lastUpdatedAt
**Before:** `@UpdateDateColumn({ name: 'last_updated_at', type: 'datetime' })`  
**After:** `@UpdateDateColumn({ type: 'datetime' })`

---

## DO NOT CHANGE
- Line 9: `@Entity('ip_reputation')` — Keep the table name

## Acceptance Criteria
- [ ] All `{ name: 'snake_case' }` removed from column decorators
- [ ] All 4 getter/setter pairs removed (failedAttempts, isBlocked, blockedUntil, captchaRequiredCount)
- [ ] File compiles without errors
