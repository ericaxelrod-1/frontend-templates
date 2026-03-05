# TASK-003: Configure data-source.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-003 |
| **Status** | Completed |
| **Story** | STORY-001: Install and Configure TypeORM SnakeNamingStrategy |
| **Description** | Add the SnakeNamingStrategy to the TypeORM CLI data source configuration used for migrations |
| **Estimated Effort** | 5 minutes |
| **Dependencies** | TASK-001 must be completed first |

---

## Instructions

### File to Edit

**File**: `angular/backend/src/database/data-source.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/database/data-source.ts`  
**Total Lines**: 53

---

### Edit 1: Add import statement

**Location**: Line 2 (after the existing `import { config } from 'dotenv';` statement)

**Add the following line after line 2:**

```typescript
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
```

**Result — lines 1-4 should look like:**

```typescript
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Permission } from '../modules/permissions/entities/permission.entity';
```

---

### Edit 2: Add namingStrategy to dataSourceOptions

**Location**: Lines 24-48 (the `dataSourceOptions` object)

**Add the following property after `synchronize: false,` (line 45) and before `migrationsRun: false,` (line 46):**

```typescript
  namingStrategy: new SnakeNamingStrategy(),
```

**Result — the dataSourceOptions object should look like:**

```typescript
export const dataSourceOptions: DataSourceOptions = {
  type: 'sqlite',
  database: process.env.DATABASE_FILE || 'db.sqlite',
  entities: [
    Permission,
    Role,
    Group,
    UiComponent,
    FrontendRoute,
    ApiEndpoint,
    GroupPermission,
    UserPermission,
    RolePermission,
    User,
    Action,
    Resource,
    LoginAttempt,
    IPReputation,
    Captcha,
  ],
  migrations: ['src/database/migrations/*{.ts,.js}'],
  synchronize: false, // Disable synchronize as we're handling schema manually
  namingStrategy: new SnakeNamingStrategy(),
  migrationsRun: false, // Disable migrations as we're handling them manually
  logging: ['query', 'error', 'schema'], // Added 'schema' logging
};
```

---

## Acceptance Criteria

- [ ] `SnakeNamingStrategy` is imported from `typeorm-naming-strategies`
- [ ] `namingStrategy: new SnakeNamingStrategy()` is present in `dataSourceOptions`
- [ ] No other code in the file is changed
- [ ] The file compiles without TypeScript errors
