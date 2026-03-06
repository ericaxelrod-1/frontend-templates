# TASK-003: Verify Backend Response Format

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-003 |
| **Status** | Open |
| **Story** | STORY-001: Implement Backend Server-Side Pagination & Sorting |
| **Description** | Check that accessing `/api/groups?page=0&pageSize=10` yields the correct nested structure. |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | TASK-002 |

---

## Instructions

### Step 1: Run the backend and request data

Ensure the backend server is running locally (e.g. `npm run start:dev`). Add a quick verification check (e.g., using `curl`, Node script, or directly in the browser with your authorization token) to ask the backend for the newly formatted `/groups` data.

### Step 2: Confirm response shape

Ensure your data response format looks like:

```json
{
  "items": [
    {
      "id": 1,
      "name": "Admins",
      ...
    }
  ],
  "total": 1,
  "page": 0,
  "pageSize": 10
}
```

---

## Acceptance Criteria

- [ ] A request to `/api/groups` gracefully handles omitted optional parameters.
- [ ] The payload matches the expected `ServerResponse` structure.
