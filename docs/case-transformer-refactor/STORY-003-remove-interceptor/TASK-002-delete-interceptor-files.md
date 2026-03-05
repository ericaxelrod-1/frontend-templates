# TASK-002: Delete Interceptor Files

| Field | Value |
|-------|-------|
| **Task ID** | STORY-003 / TASK-002 |
| **Status** | Completed |
| **Story** | STORY-003: Remove the CaseTransformInterceptor from the Frontend |
| **Description** | Delete the CaseTransformInterceptor implementation and test files |
| **Estimated Effort** | 2 minutes |
| **Dependencies** | TASK-001 must be completed first (to avoid import errors) |

---

## Files to Delete

### File 1: The interceptor implementation

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/core/interceptors/case-transform.interceptor.ts`

```bash
rm /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/core/interceptors/case-transform.interceptor.ts
```

### File 2: The interceptor test file

**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/core/interceptors/case-transform.interceptor.spec.ts`

```bash
rm /home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/core/interceptors/case-transform.interceptor.spec.ts
```

---

## Verify no other files reference the deleted files

Run:

```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/frontend
grep -rn "case-transform.interceptor" src/ --include="*.ts"
grep -rn "CaseTransformInterceptor" src/ --include="*.ts"
```

**Expected result**: No matches found (the import in `index.ts` was already removed in TASK-001).

---

## Acceptance Criteria

- [ ] `case-transform.interceptor.ts` deleted
- [ ] `case-transform.interceptor.spec.ts` deleted
- [ ] No remaining references to `CaseTransformInterceptor` or `case-transform.interceptor` in any `.ts` file
