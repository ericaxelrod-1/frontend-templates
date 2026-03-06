# TASK-001: Implement ServerResponse Model

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-001 |
| **Status** | Open |
| **Story** | STORY-002: Refactor Frontend Groups Page Layout and Data Layer |
| **Description** | Add `ServerResponse<T>` generic interface required by angular components to properly type data payloads output by the Backend. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | STORY-001 |

---

## Instructions

### Step 1: Create `server-response.model.ts`

Given instructions in the markdown rule, create or update an interface file (`angular/frontend/src/app/models/server-response.model.ts`).

### Step 2: Write interface

```typescript
export interface ServerResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

### Step 3: Ensure references work

Verify typescript compiles with the new model.

---

## Acceptance Criteria

- [ ] A file for `ServerResponse<T>` exists.
- [ ] Interface correctly matches standard properties.
