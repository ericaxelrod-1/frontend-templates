# TASK-023: Fix captcha.service.ts — Update `.used` to `.isUsed`

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-023 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | The `Captcha` entity's `used` getter/setter was removed in TASK-002. The property is now `isUsed`. Update `captcha.service.ts` to use the new name. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | TASK-002 must be completed |

> [!CAUTION]
> **NEVER** rename the column in the database. You are only updating TypeScript code references.

---

## File to Edit

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/services/captcha.service.ts`

---

## Edits

### Edit 1: Line 122 — Change `.used` to `.isUsed` in condition check

**Before (line 122):**
```typescript
    if (!captcha || captcha.used || captcha.expiresAt < new Date()) {
```

**After:**
```typescript
    if (!captcha || captcha.isUsed || captcha.expiresAt < new Date()) {
```

---

### Edit 2: Line 128 — Change `.used` to `.isUsed` in assignment

**Before (line 128):**
```typescript
      captcha.used = true;
```

**After:**
```typescript
      captcha.isUsed = true;
```

---

## Acceptance Criteria

- [ ] `captcha.used` replaced with `captcha.isUsed` on line 122
- [ ] `captcha.used = true` replaced with `captcha.isUsed = true` on line 128
- [ ] File compiles without errors (`npx tsc --noEmit`)
