# TASK-002: Configure database.config.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-002 |
| **Status** | Completed |
| **Story** | STORY-001: Install and Configure TypeORM SnakeNamingStrategy |
| **Description** | Add the SnakeNamingStrategy to the database configuration used at runtime by the NestJS application |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | TASK-001 must be completed first |

---

## Instructions

### File to Edit

**File**: `angular/backend/src/config/database.config.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/config/database.config.ts`  
**Total Lines**: 105

---

### Edit 1: Add import statement

**Location**: Line 3 (after the existing `import * as path from 'path';` statement)

**Add the following line after line 3:**

```typescript
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
```

**Result — lines 1-5 should look like:**

```typescript
import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

export default registerAs('database', () => {
```

---

### Edit 2: Add namingStrategy to SQLite config

**Location**: Lines 15-28 (the `sqliteConfig` object)

**Add the following property after `extra: { foreign_keys: true },` (line 25) and before `migrationsRun: false,` (line 26):**

```typescript
    namingStrategy: new SnakeNamingStrategy(),
```

**Result — the sqliteConfig object should look like:**

```typescript
  const sqliteConfig: TypeOrmModuleOptions = {
    type: 'sqlite',
    database: process.env.DATABASE_FILE || 'db.sqlite',
    entities: commonEntities,
    synchronize: false,
    logging:
      nodeEnv === 'development' || nodeEnv === 'test'
        ? ['query', 'error', 'schema']
        : ['error'],
    autoLoadEntities: true,
    extra: { foreign_keys: true },
    namingStrategy: new SnakeNamingStrategy(),
    migrationsRun: false,
    migrations: [], // CLI uses data-source.ts for migrations array
  };
```

---

### Edit 3: Add namingStrategy to PostgreSQL config

**Location**: Lines 30-46 (the `postgresConfig` object)

**Add the following property after `autoLoadEntities: true,` (line 42) and before `migrationsRun: false,` (line 43):**

```typescript
    namingStrategy: new SnakeNamingStrategy(),
```

**Result — the postgresConfig object should look like:**

```typescript
  const postgresConfig: TypeOrmModuleOptions = {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'permissions_db',
    schema: process.env.DB_SCHEMA || 'public',
    entities: commonEntities,
    synchronize: false,
    logging:
      nodeEnv === 'development' ? ['query', 'error', 'schema'] : ['error'],
    autoLoadEntities: true,
    namingStrategy: new SnakeNamingStrategy(),
    migrationsRun: false, // Typically false for app runtime, true for migration tool if needed
    migrations: commonMigrations,
    migrationsTableName: 'migrations_history',
  };
```

---

## Acceptance Criteria

- [ ] `SnakeNamingStrategy` is imported from `typeorm-naming-strategies`
- [ ] `namingStrategy: new SnakeNamingStrategy()` is present in `sqliteConfig`
- [ ] `namingStrategy: new SnakeNamingStrategy()` is present in `postgresConfig`
- [ ] No other code in the file is changed
- [ ] The file compiles without TypeScript errors
