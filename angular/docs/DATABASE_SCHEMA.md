# Angular Template Application - Database Schema Design

## Database Configuration

**Production Database Path:** `angular/backend/db.sqlite`

This is the primary SQLite database file used by the Angular Template Application. The database is located in the backend directory and contains all production data including:
- User accounts and authentication data
- Roles and permissions
- Login attempts and security monitoring data
- All other application data as defined in this schema

**Database Connection:**
- The NestJS backend connects to this database via TypeORM configuration
- Database migrations are applied to this file
- All seed data is populated into this database
- This is the database that should be backed up in production

**Development Notes:**
- Always verify you are working with the correct database file when debugging
- The database path is relative to the project root: `angular/backend/db.sqlite`
- Other `.sqlite` files in the project may be cache, development, or test databases

## Overview

This document outlines the database schema design for the Angular Template Application. The schema is designed to support:

1. User authentication and authorization
2. Role-based access control (RBAC)
3. User groups for logical user segmentation
4. Dynamic permission management for UI components, frontend routes, and API endpoints
5. Login attempt tracking and security monitoring (including IP reputation and CAPTCHA)
6. A clear structure primarily for SQLite, with considerations for future PostgreSQL migration.

**Naming Convention:**
- **All database table names and column names MUST use `snake_case`**. This is the definitive convention for this project.
- Entity property names in TypeScript code (TypeORM entities) will typically be `camelCase` as per JavaScript/TypeScript conventions.

**TypeORM Naming Strategy vs. Migrations:**
- TypeORM includes a naming strategy feature that can automatically translate between `camelCase` entity properties and `snake_case` database columns when TypeORM generates SQL (e.g., during `synchronize: true` or when using the query builder and repositories).
- **However, this translation DOES NOT apply to raw SQL written in migration files.** Therefore, all `CREATE TABLE`, `ALTER TABLE`, and other SQL statements within migration scripts **MUST explicitly use `snake_case`** for table and column identifiers to ensure the database schema adheres to the project convention.

## Entity Relationship Diagram (Conceptual)

```
[user] *--* [role] (via user_roles)
[user] *--* [group] (via user_groups)
[user] *--* [permission] (via user_permissions) - Direct user permissions
[user] o-- [login_attempt] (via login_attempts.user_id)

[role] *--* [permission] (via role_permissions)
[role] o--o [role] (self-referencing for hierarchy - parent_id)

[group] *--* [permission] (via group_permissions)
[group] o-- [user_group] --o [user] (user_group is user_groups table)

[permission] --o [action] (via permissions.action_id)
[permission] --o [resource] (conceptually, via permissions.resource_name and resources table)
[permission] *--* [frontend_route] (via frontend_route_permissions)
[permission] *--* [api_endpoint] (via api_endpoint_permissions)
[permission] *--* [ui_component] (via ui_component_permissions)

[login_attempt] (login_attempts)
[ip_reputation]
[captcha]
```
*(Note: The ASCII ERD above is a high-level conceptual representation and may require updates to fully detail all explicit join entities and foreign key names accurately based on the table specifications below. Table and column names here are illustrative and will follow `snake_case` in the specifications.)*

## Tables Specification

General Conventions:
- **Primary Keys (PK):** Unless otherwise specified (e.g., for M2M join tables without dedicated entities), primary keys are `id INTEGER PRIMARY KEY AUTOINCREMENT`. All PK columns are named `id`, unless the natural key is a `VARCHAR` (e.g. for `ui_components`, `frontend_routes`, `api_endpoints`).
- **Timestamps:** Standard timestamp columns are `created_at` and `updated_at`, both `DATETIME NOT NULL DEFAULT (datetime('now'))`.
- **Foreign Keys (FK):** Typically `ON DELETE CASCADE` for tight coupling where appropriate (e.g., join table entries), or `ON DELETE SET NULL` for optional relationships. Foreign key columns should be named `[referenced_table_singular]_id`. `ON UPDATE` actions are typically `NO ACTION` unless specified.

### `users` Table
Stores user account information. Corresponds to `User` entity.

| Column                              | Type         | Constraints                        | Description                             |
|-------------------------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                                | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `username`                          | VARCHAR(255) | NOT NULL, UNIQUE                   | Username for login                      |
| `email`                             | VARCHAR(255) | NOT NULL, UNIQUE                   | Email address                           |
| `password`                          | VARCHAR(255) | NOT NULL                           | Hashed password                         |
| `first_name`                        | VARCHAR(255) | NULL                               | User's first name                       |
| `last_name`                         | VARCHAR(255) | NULL                               | User's last name                        |
| `is_active`                         | BOOLEAN      | NOT NULL, DEFAULT 0                | If the user account is active           |
| `is_email_verified`                 | BOOLEAN      | NOT NULL, DEFAULT 0                | If the user's email is verified         |
| `last_login_at`                     | DATETIME     | NULL                               | Last login timestamp                    |
| `preferences`                       | TEXT         | NULL                               | User-specific preferences (JSON)        |
| `email_verified_at`                 | DATETIME     | NULL                               | Timestamp user's email was verified     |
| `registration_verification_sent_at` | DATETIME     | NULL                               | Timestamp for verification email sent   |
| `user_verified_at`                  | DATETIME     | NULL                               | Timestamp user was verified             |
| `is_deleted`                        | BOOLEAN      | NOT NULL, DEFAULT 0                | Soft delete flag                        |
| `deleted_at`                        | DATETIME     | NULL                               | Timestamp of soft delete                |
| `created_at`                        | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Account creation timestamp              |
| `updated_at`                        | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

Indexes:
- PRIMARY KEY (`id`)
- UNIQUE (`username`)
- UNIQUE (`email`)

### `roles` Table
Defines user roles for authorization. Corresponds to `Role` entity.

| Column            | Type         | Constraints                        | Description                             |
|-------------------|--------------|------------------------------------|-----------------------------------------|
| `id`              | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `name`            | VARCHAR(100) | NOT NULL, UNIQUE                   | Role name (e.g., USER, ADMIN)           |
| `description`     | VARCHAR(255) | NULL                               | Role description                        |
| `is_system_role`  | BOOLEAN      | NOT NULL, DEFAULT 0                | If it's a system-managed role           |
| `is_default`      | BOOLEAN      | NOT NULL, DEFAULT 0                | If it's a default role for new users    |
| `parent_id`       | INTEGER      | NULL, FOREIGN KEY (roles.id ON DELETE SET NULL ON UPDATE NO ACTION) | For role hierarchy                      |
| `priority`        | INTEGER      | NULL                               | Role priority for ordering/logic        |
| `created_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

Indexes:
- PRIMARY KEY (`id`)
- UNIQUE (`name`)
- INDEX (`parent_id`)

### `groups` Table
Stores information about user groups. Corresponds to `Group` entity.

| Column            | Type         | Constraints                        | Description                        |
|-------------------|--------------|------------------------------------|------------------------------------|
| `id`              | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `name`            | VARCHAR(50)  | NOT NULL, UNIQUE                   | Group name                         |
| `description`     | VARCHAR(255) | NULL                               | Group description                  |
| `settings`        | TEXT         | NULL                               | Group-specific settings (JSON)     |
| `is_system_group` | BOOLEAN      | NOT NULL, DEFAULT 0                | If it's a system-managed group     |
| `owner_id`        | INTEGER      | NULL, FOREIGN KEY (users.id ON DELETE SET NULL ON UPDATE NO ACTION) | User who owns/created the group  |
| `created_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                 |
| `updated_at`      | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp              |

### `actions` Table
Defines the granular, atomic operations or capabilities that can be performed within the application. Corresponds to the `Action` entity.

| Column        | Type         | Constraints                        | Description                             |
|---------------|--------------|------------------------------------|-----------------------------------------|
| `id`          | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique numerical identifier for the action. |
| `name`        | VARCHAR(255) | NOT NULL, UNIQUE                   | A human-readable and descriptive name for the action (e.g., 'Create New User', 'View Dashboard'). |
| `description` | VARCHAR(255) | NULL                               | A more detailed explanation of what the action entails. |
| `action_name` | VARCHAR(255) | NOT NULL                           | A system-level, programmatic key for the action (e.g., 'user_create', 'dashboard_view'). This is the stable code used internally. Not necessarily unique on its own, but combined with resource_name in permissions, it should be. |
| `icon`        | VARCHAR(255) | NULL                               | Optional icon identifier (e.g., CSS class). |
| `created_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Timestamp action definition was created. |
| `updated_at`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Timestamp action definition was updated. |

**Intended Functionality and Usage:**
- The `permissions` table links to `actions` via an `action_id` foreign key.
- An `action` (referenced by its `id` via the `action_id` foreign key in the `permissions` table) is combined with a `resource_name` (e.g., `permissions.resource_name = 'users'`) to define a granular permission like "users:create" (where 'create' would map to an action_id).
- When logging user activities or for other system references, the `action_id` or the `actions.action_name` string (e.g., 'create', 'view') from this table should be recorded along with the resource context.

### `permissions` Table
Defines specific permissions by combining a resource and an action. Corresponds to `Permission` entity.

| Column          | Type         | Constraints                        | Description                             |
|-----------------|--------------|------------------------------------|-----------------------------------------|
| `id`            | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `name`          | VARCHAR(100) | NOT NULL, UNIQUE                   | Permission name (e.g., 'users:create', 'dashboard:view'). Programmatic key. |
| `description`   | VARCHAR(255) | NULL                               | Description of the permission           |
| `resource_name` | VARCHAR(50)  | NOT NULL                           | Resource this permission applies to (e.g., 'users', 'dashboard') |
| `action_id`     | INTEGER      | NOT NULL, FOREIGN KEY (actions.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to `actions` table. Defines the verb. |
| `created_at`    | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`    | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |
| UNIQUE (`resource_name`, `action_id`) |                             | Ensures a resource can only have a specific action once. |

### `user_roles` Table (Explicit Join Entity)
Links Users to Roles.

| Column      | Type    | Constraints                                        | Description                      |
|-------------|---------|----------------------------------------------------|----------------------------------|
| `user_id`   | INTEGER | NOT NULL, FOREIGN KEY (users.id ON DELETE CASCADE ON UPDATE CASCADE) | Reference to User                |
| `role_id`   | INTEGER | NOT NULL, FOREIGN KEY (roles.id ON DELETE CASCADE ON UPDATE CASCADE) | Reference to Role                |
| PRIMARY KEY (`user_id`, `role_id`)        |                                                    |                                  |

### `role_permissions` Table (Explicit Join Entity)
Links Roles to Permissions. Corresponds to `RolePermission` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `role_id`       | INTEGER | NOT NULL, FOREIGN KEY (roles.id ON DELETE CASCADE ON UPDATE NO ACTION)   | Reference to Role                  |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to Permission            |
| `is_granted`    | BOOLEAN | NOT NULL, DEFAULT 1                | If permission is granted           |
| `created_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link creation timestamp            |
| `updated_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link last update timestamp         |
| UNIQUE (`role_id`, `permission_id`)      |                                    |                                    |


### `user_permissions` Table (Explicit Join Entity)
Links Users directly to Permissions. Corresponds to `UserPermission` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `user_id`       | INTEGER | NOT NULL, FOREIGN KEY (users.id ON DELETE CASCADE ON UPDATE NO ACTION)   | Reference to User                  |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to Permission            |
| `is_granted`    | BOOLEAN | NOT NULL, DEFAULT 1                | If permission is granted           |
| `created_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link creation timestamp            |
| `updated_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link last update timestamp         |
| UNIQUE (`user_id`, `permission_id`)      |                                    |                                    |

### `group_permissions` Table (Explicit Join Entity)
Links Groups to Permissions. Corresponds to `GroupPermission` entity.

| Column          | Type    | Constraints                        | Description                        |
|-----------------|---------|------------------------------------|------------------------------------|
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `group_id`      | INTEGER | NOT NULL, FOREIGN KEY (groups.id ON DELETE CASCADE ON UPDATE NO ACTION)  | Reference to Group                 |
| `permission_id` | INTEGER | NOT NULL, FOREIGN KEY (permissions.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to Permission            |
| `is_granted`    | BOOLEAN | NOT NULL, DEFAULT 1                | If permission is granted           |
| `created_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link creation timestamp            |
| `updated_at`    | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Link last update timestamp         |
| UNIQUE (`group_id`, `permission_id`)     |                                    |                                    |

### `user_groups` Table (Explicit Join Entity)
Links Users to Groups. Corresponds to `UserGroup` entity.

| Column                       | Type    | Constraints                        | Description                        |
|------------------------------|---------|------------------------------------|------------------------------------|
| `id`                         | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier for the link     |
| `user_id`                    | INTEGER | NOT NULL, FOREIGN KEY (users.id ON DELETE CASCADE ON UPDATE NO ACTION)   | Reference to User                  |
| `group_id`                   | INTEGER | NOT NULL, FOREIGN KEY (groups.id ON DELETE CASCADE ON UPDATE NO ACTION)  | Reference to Group                 |
| `is_admin`                   | BOOLEAN | NOT NULL, DEFAULT 0                | User is admin in this group        |
| `group_permissions_override` | TEXT    | NULL                               | JSON array of permission strings specific to this user in this group |
| `joined_at`                  | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Timestamp user joined group        |
| `last_active_at`             | DATETIME| NULL                               | Last activity timestamp in group   |
| UNIQUE (`user_id`, `group_id`)         |                                    |                                    |

### `ui_components` Table
Stores UI components requiring permissions. Corresponds to `UiComponent` entity.

| Column                 | Type         | Constraints                        | Description                             |
|------------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                   | VARCHAR(255) | PRIMARY KEY NOT NULL               | Unique identifier (e.g., selector string) |
| `description`          | TEXT         | NULL                               | Component description                   |
| `file_path`            | VARCHAR(255) | NULL                               | Path in codebase                        |
| `override_permissions` | BOOLEAN      | NOT NULL, DEFAULT 0                | Override inherited permissions          |
| `last_synced_at`       | DATETIME     | NULL                               | Timestamp of last scan                  |
| `created_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `ui_component_permissions` Table (Implicit M2M Join)
Links UI Components to Permissions.

| Column            | Type         | Constraints                        | Description                        |
|-------------------|--------------|------------------------------------|------------------------------------|
| `ui_component_id` | VARCHAR(255) | NOT NULL, FOREIGN KEY (ui_components.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to UI Component         |
| `permission_id`   | INTEGER      | NOT NULL, FOREIGN KEY (permissions.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to Permission            |
| PRIMARY KEY (`ui_component_id`, `permission_id`) |

### `frontend_routes` Table
Stores frontend routes requiring permissions. Corresponds to `FrontendRoute` entity. `id` is the route path.

| Column                 | Type         | Constraints                        | Description                             |
|------------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                   | VARCHAR(255) | PRIMARY KEY NOT NULL               | Unique identifier (route path, e.g., '/users/list') |
| `title`                | VARCHAR(255) | NULL                               | Display name for UI                     |
| `description`          | TEXT         | NULL                               | Route description                       |
| `component_name`       | VARCHAR(255) | NULL                               | Associated component name               |
| `override_permissions` | BOOLEAN      | NOT NULL, DEFAULT 0                | Override inherited permissions          |
| `last_synced_at`       | DATETIME     | NULL                               | Timestamp of last scan                  |
| `is_disabled`          | BOOLEAN      | NOT NULL, DEFAULT 0                | If route is disabled                    |
| `show_in_menu`         | BOOLEAN      | NOT NULL, DEFAULT 1                | Show in navigation menu                 |
| `icon`                 | VARCHAR(255) | NULL                               | Icon name for menu                      |
| `menu_order`           | INTEGER      | NOT NULL, DEFAULT 100              | Order in menu                           |
| `created_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `frontend_route_permissions` Table (Implicit M2M Join)
Links Frontend Routes to Permissions.

| Column              | Type         | Constraints                        | Description                        |
|---------------------|--------------|------------------------------------|------------------------------------|
| `frontend_route_id` | VARCHAR(255) | NOT NULL, FOREIGN KEY (frontend_routes.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to Frontend Route    |
| `permission_id`     | INTEGER      | NOT NULL, FOREIGN KEY (permissions.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to Permission            |
| PRIMARY KEY (`frontend_route_id`, `permission_id`) |

### `api_endpoints` Table
Stores API endpoints requiring permissions. Corresponds to `ApiEndpoint` entity. `id` is a unique identifier for the endpoint (e.g., method+path hash).

| Column                 | Type         | Constraints                        | Description                             |
|------------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                   | VARCHAR(255) | PRIMARY KEY NOT NULL               | Unique identifier (e.g., method + path hash or combination) |
| `method`               | VARCHAR(20)  | NOT NULL                           | HTTP method (GET, POST, etc.)           |
| `path`                 | VARCHAR(255) | NOT NULL                           | API endpoint path                       |
| `description`          | TEXT         | NULL                               | Endpoint description                    |
| `controller_name`      | VARCHAR(100) | NULL                               | Controller class name                   |
| `handler_name`         | VARCHAR(100) | NULL                               | Handler method name                     |
| `override_permissions` | BOOLEAN      | NOT NULL, DEFAULT 0                | Override inherited permissions          |
| `last_synced_at`       | DATETIME     | NULL                               | Timestamp of last scan                  |
| `created_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |
| UNIQUE (`method`, `path`)             |                                    | Ensures method+path combination is unique |

### `api_endpoint_permissions` Table (Implicit M2M Join)
Links API Endpoints to Permissions.

| Column            | Type         | Constraints                        | Description                        |
|-------------------|--------------|------------------------------------|------------------------------------|
| `api_endpoint_id` | VARCHAR(255) | NOT NULL, FOREIGN KEY (api_endpoints.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to API Endpoint         |
| `permission_id`   | INTEGER      | NOT NULL, FOREIGN KEY (permissions.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to Permission            |
| PRIMARY KEY (`api_endpoint_id`, `permission_id`) |

### `login_attempts` Table
Stores login attempts. Corresponds to `LoginAttempt` entity.

| Column            | Type     | Constraints                        | Description                        |
|-------------------|----------|------------------------------------|------------------------------------|
| `id`              | INTEGER  | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `ip_address`      | TEXT     | NOT NULL                           | IP address of login attempt        |
| `user_agent`      | TEXT     | NOT NULL                           | Client user agent                  |
| `email_attempted` | TEXT     | NULL                               | Email used for attempt             |
| `status`          | TEXT     | NOT NULL, DEFAULT 'failed'         | Status (success, failed, etc.)     |
| `user_id`         | INTEGER  | NULL, FOREIGN KEY (users.id ON DELETE SET NULL ON UPDATE NO ACTION) | Associated user ID                 |
| `failure_reason`  | TEXT     | NULL                               | Reason for failed login            |
| `metadata`        | TEXT     | NULL                               | Additional JSON metadata           |
| `attempted_at`    | DATETIME | NOT NULL, DEFAULT (datetime('now')) | Timestamp of attempt               |

Indexes: `ip_address`, `email_attempted`, `status`, `attempted_at`.

### `ip_reputation` Table
Stores IP address reputation data for security monitoring.

| Column                   | Type    | Constraints                        | Description                               |
|--------------------------|---------|------------------------------------|-------------------------------------------|
| `id`                     | INTEGER | PRIMARY KEY AUTOINCREMENT          | Unique identifier                         |
| `ip_address`             | TEXT    | NOT NULL, UNIQUE                   | IP address                                |
| `status`                 | TEXT    | NOT NULL, DEFAULT 'good'           | Reputation status (good, suspicious, bad) |
| `reputation_score`       | REAL    | DEFAULT 100                        | Numerical reputation score                |
| `geo_location`           | TEXT    | NULL                               | Geo-location data (JSON)                  |
| `statistics`             | TEXT    | NULL                               | Usage statistics (JSON)                   |
| `block_history`          | TEXT    | NULL                               | History of blocks (JSON)                  |
| `failed_attempts`        | INTEGER | NOT NULL, DEFAULT 0                | Count of failed attempts from this IP     |
| `is_blocked`             | BOOLEAN | NOT NULL, DEFAULT 0                | If the IP is currently blocked            |
| `blocked_until`          | DATETIME| NULL                               | Timestamp until which IP is blocked       |
| `captcha_required_count` | INTEGER | NOT NULL, DEFAULT 0                | How many times CAPTCHA was required       |
| `metadata`               | TEXT    | NULL                               | Additional JSON metadata                  |
| `created_at`             | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Record creation timestamp                 |
| `updated_at`             | DATETIME| NOT NULL, DEFAULT (datetime('now')) | Record last update timestamp              |

Indexes: `ip_address` (UNIQUE), `is_blocked`.

### `captcha` Table
Stores CAPTCHA challenge data.

| Column       | Type     | Constraints                        | Description                        |
|--------------|----------|------------------------------------|------------------------------------|
| `id`         | INTEGER  | PRIMARY KEY AUTOINCREMENT          | Unique identifier                  |
| `type`       | TEXT     | NOT NULL, DEFAULT 'text'           | Type of CAPTCHA (text, image)      |
| `token`      | TEXT     | NOT NULL, UNIQUE                   | Unique token for this CAPTCHA instance |
| `challenge`  | TEXT     | NOT NULL                           | The CAPTCHA challenge data          |
| `solution`   | TEXT     | NOT NULL                           | The correct solution to the challenge|
| `is_used`    | BOOLEAN  | NOT NULL, DEFAULT 0                | If this CAPTCHA has been used       |
| `expires_at` | DATETIME | NOT NULL                           | Expiration timestamp for the CAPTCHA |
| `ip_address` | TEXT     | NULL                               | IP address for which it was generated|
| `metadata`   | TEXT     | NULL                               | Additional JSON metadata           |
| `created_at` | DATETIME | NOT NULL, DEFAULT (datetime('now')) | Record creation timestamp          |
| `updated_at` | DATETIME | NOT NULL, DEFAULT (datetime('now')) | Record last update timestamp       |

Indexes: `token` (UNIQUE), `expires_at`.

### `resources` Table
Corresponds to `Resource` entity. (A lookup/definition table for resource types).

### `cache_components` Table
Stores cached metadata about UI components for sync/scan purposes.

| Column           | Type         | Constraints                        | Description                             |
|------------------|--------------|------------------------------------|-----------------------------------------|
| `id`             | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `selector`       | VARCHAR(255) | NOT NULL, UNIQUE                   | Component selector string               |
| `description`    | TEXT         | NULL                               | Description of the component            |
| `file_path`      | VARCHAR(255) | NULL                               | Path to the component file              |
| `last_synced_at` | DATETIME     | NULL                               | Timestamp of last sync                  |
| `metadata`       | TEXT         | NULL                               | Additional metadata (JSON)              |
| `created_at`     | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`     | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `cache_routes` Table
Stores cached metadata about frontend routes for sync/scan purposes.

| Column           | Type         | Constraints                        | Description                             |
|------------------|--------------|------------------------------------|-----------------------------------------|
| `id`             | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `path`           | VARCHAR(255) | NOT NULL, UNIQUE                   | Route path                              |
| `description`    | TEXT         | NULL                               | Description of the route                |
| `component_name` | VARCHAR(255) | NULL                               | Name of the associated component        |
| `last_synced_at` | DATETIME     | NULL                               | Timestamp of last sync                  |
| `metadata`       | TEXT         | NULL                               | Additional metadata (JSON)              |
| `created_at`     | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`     | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |

### `cache_endpoints` Table
Stores cached metadata about API endpoints for sync/scan purposes.

| Column           | Type         | Constraints                        | Description                             |
|------------------|--------------|------------------------------------|-----------------------------------------|
| `id`             | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `method`         | VARCHAR(20)  | NOT NULL                           | HTTP method (GET, POST, etc.)           |
| `path`           | VARCHAR(255) | NOT NULL                           | API endpoint path                       |
| `description`    | TEXT         | NULL                               | Description of the endpoint             |
| `controller_name`| VARCHAR(100) | NULL                               | Controller class name                   |
| `handler_name`   | VARCHAR(100) | NULL                               | Handler method name                     |
| `last_synced_at` | DATETIME     | NULL                               | Timestamp of last sync                  |
| `metadata`       | TEXT         | NULL                               | Additional metadata (JSON)              |
| `created_at`     | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Creation timestamp                      |
| `updated_at`     | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Last update timestamp                   |
| UNIQUE (`method`, `path`)        |                                    | Ensures method+path combination is unique |

### `security_detected_patterns` Table
Stores detected security patterns for historical tracking and analysis. Corresponds to `SecurityDetectedPattern` entity.

| Column                 | Type         | Constraints                        | Description                             |
|------------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                   | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `pattern_type`         | VARCHAR(50)  | NOT NULL                           | Type of pattern (brute_force, distributed_attack, etc.) |
| `severity`             | VARCHAR(20)  | NOT NULL, DEFAULT 'medium'         | Severity level (low, medium, high, critical) |
| `ip_address`           | TEXT         | NOT NULL                           | Primary IP address associated with pattern |
| `detection_timestamp`  | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | When the pattern was first detected     |
| `time_window_start`    | DATETIME     | NOT NULL                           | Start of the time window for pattern analysis |
| `time_window_end`      | DATETIME     | NOT NULL                           | End of the time window for pattern analysis |
| `attempt_count`        | INTEGER      | NOT NULL, DEFAULT 0                | Total number of login attempts in pattern |
| `unique_email_count`   | INTEGER      | NOT NULL, DEFAULT 0                | Number of unique emails attempted       |
| `evidence`             | TEXT         | NOT NULL                           | JSON evidence data with detailed attempt information |
| `status`               | VARCHAR(20)  | NOT NULL, DEFAULT 'active'         | Pattern status (active, resolved, dismissed) |
| `resolved_at`          | DATETIME     | NULL                               | Timestamp when pattern was resolved     |
| `resolved_by`          | INTEGER      | NULL, FOREIGN KEY (users.id ON DELETE SET NULL ON UPDATE NO ACTION) | User who resolved the pattern |
| `resolution_notes`     | TEXT         | NULL                               | Notes about pattern resolution          |
| `metadata`             | TEXT         | NULL                               | Additional metadata (JSON)              |
| `created_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Record creation timestamp               |
| `updated_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Record last update timestamp            |

Indexes: `pattern_type`, `severity`, `ip_address`, `detection_timestamp`, `status`.

### `security_alerts` Table
Stores security alerts generated by pattern detection and other security systems. Corresponds to `SecurityAlert` entity.

| Column                 | Type         | Constraints                        | Description                             |
|------------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                   | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `alert_type`           | VARCHAR(50)  | NOT NULL                           | Type of alert (security_pattern_detected, manual_alert, etc.) |
| `severity`             | VARCHAR(20)  | NOT NULL, DEFAULT 'medium'         | Alert severity (low, medium, high, critical) |
| `title`                | VARCHAR(255) | NOT NULL                           | Alert title/summary                     |
| `message`              | TEXT         | NOT NULL                           | Detailed alert message                  |
| `source`               | VARCHAR(50)  | NOT NULL, DEFAULT 'system'         | Alert source (system, manual, api)     |
| `pattern_id`           | INTEGER      | NULL, FOREIGN KEY (security_detected_patterns.id ON DELETE CASCADE ON UPDATE NO ACTION) | Associated pattern ID |
| `ip_address`           | TEXT         | NULL                               | IP address related to alert            |
| `user_id`              | INTEGER      | NULL, FOREIGN KEY (users.id ON DELETE SET NULL ON UPDATE NO ACTION) | Associated user ID |
| `status`               | VARCHAR(20)  | NOT NULL, DEFAULT 'active'         | Alert status (active, acknowledged, resolved, dismissed) |
| `acknowledged_at`      | DATETIME     | NULL                               | Timestamp when alert was acknowledged   |
| `acknowledged_by`      | INTEGER      | NULL, FOREIGN KEY (users.id ON DELETE SET NULL ON UPDATE NO ACTION) | User who acknowledged alert |
| `resolved_at`          | DATETIME     | NULL                               | Timestamp when alert was resolved       |
| `resolved_by`          | INTEGER      | NULL, FOREIGN KEY (users.id ON DELETE SET NULL ON UPDATE NO ACTION) | User who resolved alert |
| `resolution_notes`     | TEXT         | NULL                               | Notes about alert resolution            |
| `alert_data`           | TEXT         | NULL                               | Additional alert data (JSON)            |
| `expires_at`           | DATETIME     | NULL                               | Alert expiration timestamp              |
| `created_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Record creation timestamp               |
| `updated_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Record last update timestamp            |

Indexes: `alert_type`, `severity`, `status`, `pattern_id`, `ip_address`, `user_id`, `created_at`.

### `pattern_login_attempts` Table (Explicit Join Entity)
Links detected security patterns to their associated login attempts for detailed forensic analysis. Corresponds to `PatternLoginAttempt` entity.

| Column                 | Type         | Constraints                        | Description                             |
|------------------------|--------------|------------------------------------|-----------------------------------------|
| `id`                   | INTEGER      | PRIMARY KEY AUTOINCREMENT          | Unique identifier                       |
| `pattern_id`           | INTEGER      | NOT NULL, FOREIGN KEY (security_detected_patterns.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to detected pattern |
| `login_attempt_id`     | INTEGER      | NOT NULL, FOREIGN KEY (login_attempts.id ON DELETE CASCADE ON UPDATE NO ACTION) | Reference to login attempt |
| `is_primary_evidence`  | BOOLEAN      | NOT NULL, DEFAULT 0                | If this attempt is primary evidence for the pattern |
| `created_at`           | DATETIME     | NOT NULL, DEFAULT (datetime('now')) | Link creation timestamp                 |
| UNIQUE (`pattern_id`, `login_attempt_id`) |                               | Ensures unique pattern-attempt pairs    |

Indexes: `pattern_id`, `login_attempt_id`, `is_primary_evidence`.

## API Endpoints

### Security Alerts API (`/api/security-alerts`)

The Security Alerts API provides endpoints for managing security alerts, user blocking, and alert lifecycle management.

#### Base Route
All security alert endpoints are prefixed with `/api/security-alerts`

#### Endpoints

**GET /alerts**
- **Description**: Get security alerts with filtering and pagination
- **Permission Required**: `login-monitoring:read`
- **Query Parameters**:
  - `limit` (number, optional): Maximum number of alerts to return (default: 50)
  - `offset` (number, optional): Number of alerts to skip (default: 0)
  - `status` (string, optional): Filter by alert status (active, acknowledged, resolved, dismissed)
  - `severity` (string, optional): Filter by severity (low, medium, high, critical)
  - `alertType` (string, optional): Filter by alert type
  - `dateFrom` (string, optional): Filter alerts from this date (ISO format)
  - `dateTo` (string, optional): Filter alerts until this date (ISO format)
  - `sortBy` (string, optional): Field to sort by (default: createdAt)
  - `sortDirection` (string, optional): Sort direction - 'asc' or 'desc' (default: desc)
- **Response**: Array of SecurityAlert objects with total count

**POST /alerts/:id/acknowledge**
- **Description**: Acknowledge a security alert
- **Permission Required**: `login-monitoring:manage`
- **Parameters**: 
  - `id` (number): Alert ID
- **Body**: AcknowledgeAlertDto (optional acknowledgment data)
- **Response**: Success message with updated alert

**POST /alerts/:id/resolve**
- **Description**: Resolve a security alert
- **Permission Required**: `login-monitoring:manage`
- **Parameters**: 
  - `id` (number): Alert ID
- **Body**: ResolveAlertDto with optional `notes` field
- **Response**: Success message with updated alert

**POST /alerts/:id/dismiss**
- **Description**: Dismiss a security alert
- **Permission Required**: `login-monitoring:manage`
- **Parameters**: 
  - `id` (number): Alert ID
- **Response**: Success message with updated alert

**POST /users/:id/block**
- **Description**: Block a user account
- **Permission Required**: `users:manage`
- **Parameters**: 
  - `id` (number): User ID
- **Body**: BlockUserDto with `reason` and optional `durationHours`
- **Response**: Success message

**PUT /users/:id/unblock**
- **Description**: Unblock a user account
- **Permission Required**: `users:manage`
- **Parameters**: 
  - `id` (number): User ID
- **Response**: Success message

### Login Monitoring API (`/api/login-monitoring`)

The Login Monitoring API provides endpoints for monitoring login attempts, patterns, and testing alerts.

#### Base Route
All login monitoring endpoints are prefixed with `/api/login-monitoring`

#### Endpoints

**POST /alert/test**
- **Description**: Send a test security alert
- **Permission Required**: `login-monitoring:read`
- **Body**: Object with `message` field
- **Response**: Success message
- **Note**: Test alerts are stored in the database and can be viewed in the security alerts dashboard

### Data Transfer Objects (DTOs)

#### AlertFilters Interface
```typescript
interface AlertFilters {
  status?: string;
  severity?: string;
  alertType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  search?: string;
}
```

#### SecurityAlert Interface
```typescript
interface SecurityAlert {
  id: number;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  source: string;
  patternId?: number;
  ipAddress?: string;
  userId?: number;
  status: string;
  acknowledgedAt?: Date;
  acknowledgedBy?: number;
  resolvedAt?: Date;
  resolvedBy?: number;
  resolutionNotes?: string;
  alertData?: any;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```
