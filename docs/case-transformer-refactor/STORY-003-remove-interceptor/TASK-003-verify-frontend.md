# TASK-003: Verify Frontend Works Without Interceptor

| Field | Value |
|-------|-------|
| **Task ID** | STORY-003 / TASK-003 |
| **Status** | Open |
| **Story** | STORY-003: Remove the CaseTransformInterceptor from the Frontend |
| **Description** | Verify the frontend compiles, tests pass, and the application works correctly without the interceptor |
| **Estimated Effort** | 20 minutes |
| **Dependencies** | TASK-001 and TASK-002 must be completed |

---

## Instructions

### Step 1: Verify frontend compilation

```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/frontend
npx ng build
```

**Expected result**: Build succeeds without errors.

### Step 2: Run frontend tests

```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/frontend
npx ng test --watch=false
```

**Expected result**: All tests pass. Tests that previously tested the `CaseTransformInterceptor` directly are now deleted and should not run.

### Step 3: Start both backend and frontend

**Terminal 1 — Backend:**
```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/backend
npm run start:dev
```

**Terminal 2 — Frontend:**
```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/frontend
npx ng serve
```

### Step 4: Manual verification

Open the browser and navigate to the application. Verify:

1. **Login flow works**: Log in with test credentials. The login response should return camelCase keys (`accessToken`, `refreshToken`, `csrfToken`, `firstName`, `lastName`, etc.) natively from the backend — no interceptor transformation needed.

2. **User data displays correctly**: After login, verify user information displays with correct names and values.

3. **API responses are camelCase**: Open browser DevTools → Network tab. Make any API request and inspect the response JSON. Verify the keys are already in camelCase (because the backend now returns camelCase thanks to the naming strategy).

4. **No console errors**: Check the browser console for any errors related to undefined properties or missing data.

---

## Acceptance Criteria

- [ ] Frontend compiles without errors
- [ ] All frontend tests pass
- [ ] Login flow works correctly
- [ ] API responses from backend contain camelCase keys without interceptor
- [ ] No browser console errors related to property naming
