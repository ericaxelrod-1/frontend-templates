# TASK-025: Fix login-monitoring.controller.ts — Update removed property references

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-025 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `IPReputation` entity's getter/setter aliases were removed in TASK-004. Update `login-monitoring.controller.ts` to use the canonical property names. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | TASK-004 must be completed |

> [!CAUTION]
> **NEVER** change the JSON response keys (`failedAttempts`, `isBlocked`, `blockedUntil`). These are the API contract with the frontend. Only change the **right-hand side** expressions that read from the entity.

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`

---

## Edits

### Edit 1: Line 367 — Change `.isBlocked` to `.isManuallyBlocked`

**Before (line 367):**
```typescript
      isBlocked: reputation.isBlocked,
```

**After:**
```typescript
      isBlocked: reputation.isManuallyBlocked,
```

---

### Edit 2: Line 368 — Change `.blockedUntil` to `.blockedUntilAuto`

**Before (line 368):**
```typescript
      blockedUntil: reputation.blockedUntil,
```

**After:**
```typescript
      blockedUntil: reputation.blockedUntilAuto,
```

---

## Acceptance Criteria

- [ ] `reputation.isBlocked` replaced with `reputation.isManuallyBlocked` on line 367
- [ ] `reputation.blockedUntil` replaced with `reputation.blockedUntilAuto` on line 368
- [ ] JSON response keys (`isBlocked`, `blockedUntil`) are NOT changed
- [ ] File compiles without errors (`npx tsc --noEmit`)
