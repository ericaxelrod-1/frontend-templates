# TASK-001: Remove Interceptor Registration

| Field | Value |
|-------|-------|
| **Task ID** | STORY-003 / TASK-001 |
| **Status** | Open |
| **Story** | STORY-003: Remove the CaseTransformInterceptor from the Frontend |
| **Description** | Remove the CaseTransformInterceptor from the HTTP interceptor providers array |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | STORY-001 and STORY-002 must be fully completed and verified |

---

## File to Edit

**File**: `angular/frontend/src/app/core/interceptors/index.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/core/interceptors/index.ts`  
**Total Lines**: 9

---

## Edits

### Replace the entire file contents with:

```typescript
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './auth.interceptor';

export const httpInterceptorProviders = [
  { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
];
```

**What was removed:**
- Line 3: `import { CaseTransformInterceptor } from './case-transform.interceptor';`
- Line 7: `{ provide: HTTP_INTERCEPTORS, useClass: CaseTransformInterceptor, multi: true },`
- Line 6: The comment about interceptor ordering (no longer relevant)

---

## Acceptance Criteria

- [ ] `CaseTransformInterceptor` import removed
- [ ] `CaseTransformInterceptor` provider removed from the array
- [ ] `AuthInterceptor` registration is unchanged
- [ ] File compiles without errors
