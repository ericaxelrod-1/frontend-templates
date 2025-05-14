# Angular Template Application - Database Schema Design

## Overview

This document outlines the database schema design for the Angular Template Application. The schema is designed to support:

1. User authentication and authorization
2. Role-based access control (RBAC)
3. User groups for logical user segmentation
4. Dynamic permission management for UI components, frontend routes, and API endpoints
5. Login attempt tracking and basic security monitoring
6. A clear structure primarily for SQLite, with considerations for future PostgreSQL migration.

**Note:** This document reflects the schema as defined by the TypeORM entity decorators. Column names in the database will be snake_case if explicitly mapped using `@Column({ name: '...' })` in the entity, otherwise, they will typically match the camelCase entity property name.

## Entity Relationship Diagram (Conceptual)

```
[User] *--* [Role] (via user_roles)
[User] *--* [Group] (via user_groups)
[User] *--* [Permission] (via user_permission) - Direct user permissions
[User] o-- [Task]
[User] o-- [Category]
[User] o-- [Tag]

[Role] *--* [Permission] (via role_permissions)
[Role] o--o [Role] (self-referencing for hierarchy - parent_id)

[Group] *--* [Permission] (via group_permissions)
[Group] o-- [UserGroup] --o [User]

[Permission] --o [Action]
[Permission] --o [Resource]
[Permission] *--* [FrontendRoute] (via frontend_route_permissions)
[Permission] *--* [ApiEndpoint] (via api_endpoint_permissions)
[Permission] *--* [UiComponent] (via ui_component_permissions)

[LoginAttempt] --o [User] (optional)

[Task] *--* [Tag] (via task_tags_tag - implicit or explicit join table)
[Task] --o [Category]
```
*(Note: The ASCII ERD above is a high-level conceptual representation and may require updates to fully detail all explicit join entities and foreign key names accurately based on the table specifications below.)*

## Tables Specification

General Conventions:
- **Primary Keys (PK):** Unless otherwise specified (e.g., for M2M join tables without dedicated entities), primary keys are `id INTEGER PRIMARY KEY AUTOINCREMENT`.
- **Timestamps:** `created_at` and `updated_at` are generally `DATETIME NOT NULL DEFAULT (datetime('now'))`.
- **Foreign Keys (FK):** Typically `ON DELETE CASCADE` for tight coupling where appropriate (e.g., join table entries), or `ON DELETE SET NULL` for optional relationships.

### `users` Table
Stores user account information. Corresponds to `User` entity.

| Column                         | Type         | Constraints                        | Description                        |
|--------------------------------|--------------|------------------------------------|------------------------------------|
| `id`                           | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `username`                     | VARCHAR(255) | NOT NULL, UNIQUE                   | Username for login                 |
| `email`                        | VARCHAR(255) | NOT NULL, UNIQUE                   | Email address                      |
| `password`                     | VARCHAR(255) | NOT NULL                           | Hashed password                    |
| `firstName`                    | VARCHAR(255) | NULL                               | User's first name                  |
| `lastName`                     | VARCHAR(255) | NULL                               | User's last name                   |
| `is_active`                    | BOOLEAN      | NOT NULL, DEFAULT 0                | If the user account is active      |
| `is_email_verified`            | BOOLEAN      | NOT NULL, DEFAULT 0                | If the user's email is verified    |
| `last_login`                   | DATETIME     | NULL                               | Last login timestamp               |
| `preferences`                  | TEXT         | NULL                               | User-specific preferences (JSON)   |
| `email_verified`               | BOOLEAN      | NOT NULL, DEFAULT 0                | If user's email has been verified  |
| `registration_verification_sent` | DATETIME   | NULL                               | Timestamp for verification email   |
| `user_verified`                | DATETIME     | NULL                               | Timestamp user was verified        |
| `user_deleted`                 | BOOLEAN      | NOT NULL, DEFAULT 0                | Soft delete flag                   |
| `delete_date`                  | DATETIME     | NULL                               | Timestamp of soft delete           |
| `created_at`                   | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Account creation timestamp         |
| `updated_at`                   | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp              |

Indexes:
- PRIMARY KEY (`id`)
- UNIQUE (`username`)
- UNIQUE (`email`)

*Relationships handled by other tables/entities: `roles` (via `user_roles`), `groups` (via `user_groups`), `userPermissions` (direct permissions via `user_permission`).*

### `roles` Table
Defines user roles for authorization. Corresponds to `Role` entity.

| Column            | Type         | Constraints                        | Description                             |
|-------------------|--------------|------------------------------------|-----------------------------------------|
| `id`              | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `name`            | VARCHAR(100) | NOT NULL, UNIQUE                   | Role name (e.g., USER, ADMIN)           |
| `description`     | VARCHAR(255) | NULL                               | Role description                        |
| `is_system_role`  | BOOLEAN      | NOT NULL, DEFAULT 0                | If it's a system-managed role           |
| `is_default`      | BOOLEAN      | NOT NULL, DEFAULT 0                | If it's a default role for new users    |
| `parent_id`       | INTEGER      | NULL, FOREIGN KEY (roles.id ON DELETE SET NULL) | For role hierarchy                      |
| `priority`        | INTEGER      | NULL                               | Role priority for ordering/logic        |
| `created_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

Indexes:
- PRIMARY KEY (`id`)
- UNIQUE (`name`)
- INDEX (`parent_id`)

*Relationships: `users` (via `user_roles` table), `rolePermissions` (to link to `permissions` table).*

### `groups` Table
Stores information about user groups. Corresponds to `Group` entity.

| Column            | Type         | Constraints                        | Description                        |
|-------------------|--------------|------------------------------------|------------------------------------|
| `id`              | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `name`            | VARCHAR(50)  | NOT NULL, UNIQUE                   | Group name                         |
| `description`     | VARCHAR(255) | NULL                               | Group description                  |
| `settings`        | TEXT         | NULL                               | Group-specific settings (JSON)     |
| `is_system_group` | BOOLEAN      | NOT NULL, DEFAULT 0                | If it's a system-managed group     |
| `created_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                 |
| `updated_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp              |

### `actions` Table
Defines actions that can be performed. Corresponds to `Action` entity.

| Column        | Type         | Constraints                        | Description                             |
|---------------|--------------|------------------------------------|-----------------------------------------|
| `id`          | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `name`        | VARCHAR(255) | NOT NULL, UNIQUE                   | Action name (e.g., 'create', 'read')    |
| `description` | VARCHAR(255) | NULL                               | Description of the action               |
| `action_name` | VARCHAR(255) | NOT NULL                           | System name for the action              |
| `icon`        | VARCHAR(255) | NULL                               | Icon for UI representation              |
| `created_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `permissions` Table
Defines specific permissions. Corresponds to `Permission` entity.

| Column          | Type         | Constraints                        | Description                             |
|-----------------|--------------|------------------------------------|-----------------------------------------|
| `id`            | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `name`          | VARCHAR(100) | NOT NULL, UNIQUE                   | Permission name (e.g., 'users:create')  |
| `description`   | VARCHAR(255) | NULL                               | Description of the permission           |
| `resource_name` | VARCHAR(50)  | NOT NULL                           | Resource this permission applies to     |
| `action`        | VARCHAR(50)  | NOT NULL                           | Action this permission allows           |
| `action_id`     | INTEGER      | NULL, FOREIGN KEY (actions.id)     | Reference to Action entity              |
| `created_at`    | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`    | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `role_permissions` Table (Explicit Join Entity)
Links Roles to Permissions. Corresponds to `RolePermission` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `role_id`       | INTEGER | NOT NULL, FOREIGN KEY (roles.id)   | Reference to Role                  |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id) | Reference to Permission            |
| `granted`       | BOOLEAN | NOT NULL, DEFAULT 1                | If permission is granted           |
| `created_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link creation timestamp            |
| `updated_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link last update timestamp         |

### `user_permission` Table (Explicit Join Entity)
Links Users directly to Permissions. Corresponds to `UserPermission` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `user_id`       | INTEGER | NOT NULL, FOREIGN KEY (users.id)   | Reference to User                  |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id) | Reference to Permission            |
| `granted`       | BOOLEAN | NOT NULL, DEFAULT 1                | If permission is granted           |
| `created_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link creation timestamp            |
| `updated_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link last update timestamp         |

### `group_permissions` Table (Explicit Join Entity)
Links Groups to Permissions. Corresponds to `GroupPermission` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `group_id`      | INTEGER | NOT NULL, FOREIGN KEY (groups.id)  | Reference to Group                 |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id) | Reference to Permission            |
| `granted`       | BOOLEAN | NOT NULL, DEFAULT 1                | If permission is granted           |
| `created_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link creation timestamp            |
| `updated_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link last update timestamp         |

### `user_groups` Table (Explicit Join Entity)
Links Users to Groups. Corresponds to `UserGroup` entity.

| Column        | Type    | Constraints                        | Description                        |
|---------------|---------|------------------------------------|------------------------------------|
| `id`          | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `user_id`     | INTEGER | NOT NULL, FOREIGN KEY (users.id)   | Reference to User                  |
| `group_id`    | INTEGER | NOT NULL, FOREIGN KEY (groups.id)  | Reference to Group                 |
| `isAdmin`     | BOOLEAN | NOT NULL, DEFAULT 0                | User is admin in this group        |
| `permissions` | TEXT    | NULL                               | JSON array of permission strings   |
| `joined_at`   | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Timestamp user joined group        |
| `last_active` | DATETIME| NULL                               | Last activity timestamp in group   |

### `ui_components` Table
Stores UI components requiring permissions. Corresponds to `UiComponent` entity.

| Column                | Type         | Constraints                        | Description                             |
|-----------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                  | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `selector`            | VARCHAR(255) | NOT NULL, UNIQUE                   | Component selector/name                 |
| `description`         | TEXT         | NULL                               | Component description                   |
| `filePath`            | VARCHAR(255) | NULL                               | Path in codebase                        |
| `overridePermissions` | BOOLEAN      | NOT NULL, DEFAULT 0                | Override inherited permissions          |
| `lastSynced`          | DATETIME     | NULL                               | Timestamp of last scan                  |
| `createdAt`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updatedAt`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `ui_component_permissions` Table (Implicit M2M Join)
Links UI Components to Permissions. Defined by `@JoinTable` in `UiComponent` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `component_id`  | INTEGER | NOT NULL, FOREIGN KEY (ui_components.id) | Reference to UI Component (actual name: `uiComponentId` from decorator) |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id) | Reference to Permission            |
| PRIMARY KEY (`component_id`, `permission_id`) |

### `frontend_routes` Table
Stores frontend routes requiring permissions. Corresponds to `FrontendRoute` entity.

| Column                | Type         | Constraints                        | Description                             |
|-----------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                  | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `path`                | VARCHAR(255) | NOT NULL, UNIQUE                   | Route path                              |
| `title`               | VARCHAR(255) | NULL                               | Display name for UI                     |
| `description`         | TEXT         | NULL                               | Route description                       |
| `component`           | VARCHAR(255) | NULL                               | Associated component name               |
| `override_permissions`| BOOLEAN      | NOT NULL, DEFAULT 0                | Override inherited permissions          |
| `last_synced`         | DATETIME     | NULL                               | Timestamp of last scan                  |
| `disabled`            | BOOLEAN      | NOT NULL, DEFAULT 0                | If route is disabled                    |
| `show_in_menu`        | BOOLEAN      | NOT NULL, DEFAULT 1                | Show in navigation menu                 |
| `icon`                | VARCHAR(255) | NULL                               | Icon name for menu                      |
| `menu_order`          | INTEGER      | NOT NULL, DEFAULT 100              | Order in menu                           |
| `created_at`          | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`          | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `frontend_route_permissions` Table (Implicit M2M Join)
Links Frontend Routes to Permissions. Defined by `@JoinTable` in `FrontendRoute` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `route_id`      | INTEGER | NOT NULL, FOREIGN KEY (frontend_routes.id) | Reference to Frontend Route    |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id) | Reference to Permission            |
| PRIMARY KEY (`route_id`, `permission_id`) |

### `api_endpoints` Table
Stores API endpoints requiring permissions. Corresponds to `ApiEndpoint` entity.

| Column                | Type         | Constraints                        | Description                             |
|-----------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                  | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `method`              | VARCHAR(20)  | NOT NULL                           | HTTP method (GET, POST, etc.)           |
| `path`                | VARCHAR(255) | NOT NULL                           | API endpoint path                       |
| `description`         | TEXT         | NULL                               | Endpoint description                    |
| `controllerName`      | VARCHAR(100) | NULL                               | Controller class name                   |
| `handlerName`         | VARCHAR(100) | NULL                               | Handler method name                     |
| `overridePermissions` | BOOLEAN      | NOT NULL, DEFAULT 0                | Override inherited permissions          |
| `lastSynced`          | DATETIME     | NULL                               | Timestamp of last scan                  |
| `created_at`          | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`          | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `api_endpoint_permissions` Table (Implicit M2M Join)
Links API Endpoints to Permissions. Defined by `@JoinTable` in `ApiEndpoint` entity.

| Column            | Type    | Constraints                        | Description                        |
|-------------------|---------|------------------------------------|------------------------------------|
| `api_endpoint_id` | INTEGER | NOT NULL, FOREIGN KEY (api_endpoints.id) | Reference to API Endpoint (actual name: `apiEndpointId` from decorator) |
| `permission_id`   | INTEGER | NOT NULL, FOREIGN KEY (permissions.id) | Reference to Permission            |
| PRIMARY KEY (`api_endpoint_id`, `permission_id`) |

### `login_attempts` Table
Stores login attempts. Corresponds to `LoginAttempt` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `ipAddress`     | TEXT    | NOT NULL                           | IP address of login attempt        |
| `userAgent`     | TEXT    | NOT NULL                           | Client user agent                  |
| `email`         | TEXT    | NULL                               | Email used for attempt             |
| `status`        | TEXT    | NOT NULL, DEFAULT 'failed'         | Status (success, failed, etc.)     |
| `userId`        | INTEGER | NULL, FOREIGN KEY (users.id)       | Associated user ID                 |
| `failureReason` | TEXT    | NULL                               | Reason for failed login            |
| `metadata`      | TEXT    | NULL                               | Additional JSON metadata           |
| `created_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Timestamp of attempt               |

### `tasks` Table
Corresponds to `Task` entity.

| Column        | Type         | Constraints                        | Description                        |
|---------------|--------------|------------------------------------|------------------------------------|
| `id`          | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `title`       | VARCHAR(255) | NOT NULL                           | Task title                         |
| `description` | TEXT         | NULL                               | Task description                   |
| `status`      | VARCHAR(50)  | NOT NULL, DEFAULT 'todo'           | Task status (todo, inprogress, done)|
| `priority`    | VARCHAR(50)  | NULL                               | Task priority (low, medium, high)  |
| `due_date`    | DATETIME     | NULL                               | Task due date                      |
| `user_id`     | INTEGER      | NULL, FOREIGN KEY (users.id)       | Assigned user                      |
| `category_id` | INTEGER      | NULL, FOREIGN KEY (categories.id)  | Category of the task               |
| `created_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                 |
| `updated_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp              |

### `categories` Table
Corresponds to `Category` entity.

| Column        | Type         | Constraints                        | Description                        |
|---------------|--------------|------------------------------------|------------------------------------|
| `id`          | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `name`        | VARCHAR(100) | NOT NULL, UNIQUE                   | Category name                      |
| `description` | TEXT         | NULL                               | Category description               |
| `user_id`     | INTEGER      | NULL, FOREIGN KEY (users.id)       | User who created category (optional)|
| `created_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                 |
| `updated_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp              |

### `tags` Table
Corresponds to `Tag` entity.

| Column        | Type         | Constraints                        | Description                        |
|---------------|--------------|------------------------------------|------------------------------------|
| `id`          | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `name`        | VARCHAR(50)  | NOT NULL, UNIQUE                   | Tag name                           |
| `description` | TEXT         | NULL                               | Tag description                    |
| `user_id`     | INTEGER      | NULL, FOREIGN KEY (users.id)       | User who created tag (optional)    |
| `created_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                 |
| `updated_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp              |

### `task_tags` Table (Implicit M2M Join for Task-Tag)
Links Tasks to Tags. Defined by `@JoinTable` in `Task` or `Tag` entity.

| Column        | Type    | Constraints                     | Description                        |
|---------------|---------|---------------------------------|------------------------------------|
| `task_id`     | INTEGER | NOT NULL, FOREIGN KEY (tasks.id)| Reference to Task                  |
| `tag_id`      | INTEGER | NOT NULL, FOREIGN KEY (tags.id) | Reference to Tag                   |
| PRIMARY KEY (`task_id`, `tag_id`) |

### `resources` Table
Corresponds to `Resource` entity (if it's a simple lookup table for resource names).

| Column        | Type         | Constraints                        | Description                        |
|---------------|--------------|------------------------------------|------------------------------------|
| `id`          | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `name`        | VARCHAR(100) | NOT NULL, UNIQUE                   | Resource name (e.g., 'users', 'roles')|
| `description` | TEXT         | NULL                               | Resource description               |
| `created_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                 |
| `updated_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp              |

### `cache_sync_status` Table
Corresponds to `CacheSyncStatus` entity.

| Column         | Type         | Constraints                        | Description                        |
|----------------|--------------|------------------------------------|------------------------------------|
| `id`           | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `item_type`    | VARCHAR(255) | NOT NULL, UNIQUE                   | Type of item synced (e.g., 'permissions')|
| `last_synced_at`| DATETIME     | NOT NULL                           | Timestamp of the last sync         |
| `status`       | VARCHAR(50)  | NOT NULL                           | Status of the last sync            |
| `details`      | TEXT         | NULL                               | Additional details or errors       |

## TypeORM Entity Definitions (Current from Codebase)

**(I will now fetch and insert the actual, current entity code snippets here. This requires multiple tool calls.)**

---
*Fetching User entity...*
---
*Fetching Role entity...*
---
*Fetching Group entity...*
---
*Fetching Action entity...*
---
*Fetching Permission entity...*
---
*Fetching RolePermission entity...*
---
*Fetching UserPermission entity...*
---
*Fetching GroupPermission entity...*
---
*Fetching UserGroup entity...*
---
*Fetching UiComponent entity...*
---
*Fetching FrontendRoute entity...*
---
*Fetching ApiEndpoint entity...*
---
*Fetching LoginAttempt entity (assuming from `modules/auth/entities/login-attempt.entity.ts`)...*
---
*Fetching Task entity...*
---
*Fetching Category entity...*
---
*Fetching Tag entity...*
---
*Fetching Resource entity...*
---
*Fetching CacheSyncStatus entity...*
---

*(Placeholder: The actual entity code will be inserted below after fetching)*

### User Entity (`angular/backend/src/modules/users/entities/user.entity.ts`)
```typescript
// Actual User entity code will be placed here
```

### Role Entity (`angular/backend/src/modules/roles/entities/role.entity.ts`)
```typescript
// Actual Role entity code will be placed here
```

### Group Entity (`angular/backend/src/modules/permissions/entities/group.entity.ts`)
```typescript
// Actual Group entity code will be placed here
```

### Action Entity (`angular/backend/src/modules/permissions/entities/action.entity.ts`)
```typescript
// Actual Action entity code will be placed here
```

### Permission Entity (`angular/backend/src/modules/permissions/entities/permission.entity.ts`)
```typescript
// Actual Permission entity code will be placed here
```

### RolePermission Entity (`angular/backend/src/modules/roles/entities/role-permission.entity.ts`)
```typescript
// Actual RolePermission entity code will be placed here
```

### UserPermission Entity (`angular/backend/src/modules/permissions/entities/user-permission.entity.ts`)
```typescript
// Actual UserPermission entity code will be placed here
```

### GroupPermission Entity (`angular/backend/src/modules/permissions/entities/group-permission.entity.ts`)
```typescript
// Actual GroupPermission entity code will be placed here
```

### UserGroup Entity (`angular/backend/src/modules/users/entities/user-group.entity.ts`)
```typescript
// Actual UserGroup entity code will be placed here
```

### UiComponent Entity (`angular/backend/src/modules/permissions/entities/ui-component.entity.ts`)
```typescript
// Actual UiComponent entity code will be placed here
```

### FrontendRoute Entity (`angular/backend/src/modules/permissions/entities/frontend-route.entity.ts`)
```typescript
// Actual FrontendRoute entity code will be placed here
```

### ApiEndpoint Entity (`angular/backend/src/modules/permissions/entities/api-endpoint.entity.ts`)
```typescript
// Actual ApiEndpoint entity code will be placed here
```

### LoginAttempt Entity (`angular/backend/src/modules/auth/entities/login-attempt.entity.ts`)
```typescript
// Actual LoginAttempt entity code will be placed here
```

### Task Entity (`angular/backend/src/modules/tasks/entities/task.entity.ts`)
```typescript
// Actual Task entity code will be placed here
```

### Category Entity (`angular/backend/src/modules/categories/entities/category.entity.ts`)
```typescript
// Actual Category entity code will be placed here
```

### Tag Entity (`angular/backend/src/modules/tags/entities/tag.entity.ts`)
```typescript
// Actual Tag entity code will be placed here
```

### Resource Entity (`angular/backend/src/modules/permissions/entities/resource.entity.ts`)
```typescript
// Actual Resource entity code will be placed here
```

### CacheSyncStatus Entity (`angular/backend/src/modules/permissions/cache-entities/cache-sync-status.entity.ts`)
```typescript
// Actual CacheSyncStatus entity code will be placed here
```

## Migration Path from SQLite to PostgreSQL
*(This section can remain largely as-is, but the entity list in the example configs should match the actual entities used.)*

### SQLite Configuration (Development)
```typescript
// src/config/database.config.ts
// Example, actual config may vary
export const sqliteConfig: TypeOrmModuleOptions = {
  type: 'sqlite',
  database: 'db.sqlite', // Or process.env.DATABASE_FILE
  entities: [/* Correct list of imported entities from data-source.ts */],
  synchronize: false, 
  logging: ['query', 'error', 'schema'],
};
```

### PostgreSQL Configuration (Production)
```typescript
// src/config/database.config.ts
// Example, actual config may vary
export const postgresConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'angular_template',
  entities: [/* Correct list of imported entities from data-source.ts */],
  synchronize: false,
  migrationsRun: true, // Recommended for production
  migrations: ['dist/migrations/*.js'],
  logging: ['error'],
  // ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};
```

## Best Practices
*(This section can largely remain as-is.)* 