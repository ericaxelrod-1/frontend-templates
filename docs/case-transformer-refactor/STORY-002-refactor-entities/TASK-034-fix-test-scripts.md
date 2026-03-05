# TASK-034: Fix test scripts — Update removed property references

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-034 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Test scripts reference old entity aliases. Update them to use canonical property names. |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | TASK-001 and TASK-004 must be completed |

> [!CAUTION]
> **NEVER** change the entity files. Only change the test scripts.

---

## File 1: create-test-login-attempt.ts

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/scripts/create-test-login-attempt.ts`

### Edit 1: Line 37 — Change `emailVerified` to `isEmailVerified`

**Before (line 37):**
```typescript
          emailVerified: true,
```

**After:**
```typescript
          isEmailVerified: true,
```

---

## File 2: test-login-monitoring.ts

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/scripts/test-login-monitoring.ts`

### Edit 1: Line 75 — Change `.failedAttempts` to `.failedLoginAttempts` and `.isBlocked` to condition

**Before (lines 74-76):**
```typescript
    logger.log(
      `Created IP reputation: ${reputation.ipAddress}, Failed attempts: ${reputation.failedAttempts}, Blocked: ${reputation.isBlocked}`,
    );
```

**After:**
```typescript
    logger.log(
      `Created IP reputation: ${reputation.ipAddress}, Failed attempts: ${reputation.failedLoginAttempts}, Blocked: ${reputation.isManuallyBlocked}`,
    );
```

### Edit 2: Line 88 — Same pattern

**Before (lines 87-89):**
```typescript
    logger.log(
      `Updated IP reputation: ${updatedReputation.ipAddress}, Failed attempts: ${updatedReputation.failedAttempts}, Blocked: ${updatedReputation.isBlocked}`,
    );
```

**After:**
```typescript
    logger.log(
      `Updated IP reputation: ${updatedReputation.ipAddress}, Failed attempts: ${updatedReputation.failedLoginAttempts}, Blocked: ${updatedReputation.isManuallyBlocked}`,
    );
```

---

## Acceptance Criteria

- [ ] `emailVerified` replaced with `isEmailVerified` in `create-test-login-attempt.ts`
- [ ] `failedAttempts` replaced with `failedLoginAttempts` in `test-login-monitoring.ts` (2 occurrences)
- [ ] `isBlocked` replaced with `isManuallyBlocked` in `test-login-monitoring.ts` (2 occurrences)
- [ ] Both files compile without errors (`npx tsc --noEmit`)
