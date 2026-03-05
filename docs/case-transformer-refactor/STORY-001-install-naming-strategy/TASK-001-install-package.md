# TASK-001: Install typeorm-naming-strategies Package

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-001 |
| **Status** | Completed |
| **Story** | STORY-001: Install and Configure TypeORM SnakeNamingStrategy |
| **Description** | Install the `typeorm-naming-strategies` npm package as a production dependency in the backend |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | None |

---

## Instructions

### Step 1: Navigate to the backend directory and install the package

Run the following command from the project root:

```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/backend
npm install typeorm-naming-strategies
```

### Step 2: Verify the package was added to package.json

Open the file:

**File**: `angular/backend/package.json`

Verify that `typeorm-naming-strategies` appears in the `"dependencies"` section (around lines 44-74). It should appear as:

```json
"typeorm-naming-strategies": "^4.1.0"
```

(The exact version may vary — any `^4.x` version is acceptable.)

### Step 3: Verify the package was installed

Run:

```bash
ls /home/eaxelrod/GitHub/frontend-templates/angular/backend/node_modules/typeorm-naming-strategies
```

Confirm the directory exists and contains files.

---

## Acceptance Criteria

- [ ] `typeorm-naming-strategies` is listed in `package.json` under `dependencies`
- [ ] The package is installed in `node_modules`
- [ ] No other files are modified
