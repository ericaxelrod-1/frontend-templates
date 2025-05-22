# Backlog
Last Updated: 2025-05-09

## Critical Bugs [HIGHEST PRIORITY]
### BUG-017: Fix Role Entity Import Path
- **Status**: Complete
- **Testing**: Passed
- **Dependencies**: None
- **Added**: 2025-04-17
- **Description**: The Role entity has an incorrect import path for the RolePermission entity, causing TypeScript compiler errors. This prevents proper compilation and may lead to runtime errors when accessing role permissions.

#### Implementation Notes
- **Issues Identified**:
  - Role entity imports RolePermission from an incorrect path
  - This causes linter errors and TypeScript compilation failures
  - The incorrect path was using an absolute path within the project that could create circular dependencies

- **Files Modified**:
  - `angular/backend/src/modules/roles/entities/role.entity.ts`: Changed import path from absolute to relative, added proper JSDoc comments, standardized column name formats

- **Testing Results**:
  - Linter errors related to RolePermission import were resolved
  - Entity properties properly aligned with database schema structure
  - Column names standardized with snake_case format for database consistency

### BUG-013: Fix Token Refresh 400 Bad Request Error
- **Status**: Complete
- **Testing**: Passed
- **Dependencies**: None
- **Added**: 2025-04-11
- **Description**: The token refresh mechanism is failing with 400 Bad Request errors due to property name mismatch between frontend and backend. This causes authentication to fail and users to be logged out unexpectedly.

#### Implementation Notes
- **Issues Identified**:
  - Frontend was sending `{ refreshToken: "token-value" }` but backend expected `{ token: "token-value" }`
  - This property name mismatch caused validation errors in the backend
  - The error occurred during proactive token refresh in app initialization and during regular token refresh

- **Solutions Implemented**:
  - Updated auth.service.ts to send requests with the correct property name `token`
  - Updated the RefreshTokenRequest interface to match backend expectations
  - Removed the typed RefreshTokenRequest interface reference in the service to reduce coupling

- **Files Modified**:
  - `angular/frontend/src/app/core/services/auth.service.ts`: Updated request format
  - `angular/frontend/src/app/models/user.model.ts`: Updated interface definition

- **Testing Results**:
  - Token refresh now works correctly without 400 Bad Request errors
  - Application authentication flow maintains session properly
  - Proactive token refresh in app initialization completes successfully

### BUG-010: Fix TypeORM Entity Inconsistency Between Users and Login Attempts
- **Status**: Complete
- **Testing**: Passed
- **Dependencies**: None
- **Added**: 2025-04-10
- **Description**: There's a critical inconsistency between entity definitions and database schema in the login attempt monitoring system. The login_attempt entity imports the User from 'modules/user' (singular) but the actual user data is in 'modules/users' (plural). This causes TypeORM to enforce a foreign key relationship to a non-existent table.

#### Implementation Notes
- **Issues Identified**:
  - LoginAttempt entity imports User from `../../user/entities/user.entity` (singular) but should import from `../../users/entities/user.entity` (plural)
  - User entity in "user" module uses UUID primary key while User entity in "users" module uses numeric ID
  - Even though the database constraint was fixed, TypeORM is enforcing the relationship at the application level

- **Solutions Implemented**:
  - Updated the import path in login-attempt.entity.ts to point to the correct users module
  - Ensured the userId field type correctly matches the primary key type in the users table (number)
  - Created a database migration (FixLoginAttemptUserForeignKey) to update the foreign key constraint

- **Files Modified**:
  - `angular/backend/src/modules/auth/entities/login-attempt.entity.ts`: Updated import paths and relationship
  - `angular/backend/src/migrations/1720000000000-FixLoginAttemptUserForeignKey.ts`: Created migration to fix FK constraint

- **Testing Results**:
  - Entity relationship definition is now correctly pointing to the users module
  - Database migration successfully updates the foreign key constraint
  - Login functionality works properly with the corrected relationships

### BUG-009: Fix Foreign Key Constraint in Login Attempt Table
- **Status**: Complete
- **Testing**: Passed
- **Dependencies**: None
- **Added**: 2025-04-10
- **Description**: Fix the foreign key constraint in the login_attempt table that is causing login failures. The constraint is referencing the old `user` table which was dropped during the database schema consolidation.

#### Implementation Notes
- **Issues Encountered**: 
  - Foreign key constraint was pointing to a non-existent table
  - Had to recreate the login_attempt table with proper structure

- **Files Modified**:
  - `angular/docs/DATABASE_SCHEMA.md`: Updated to reflect current database architecture
  - Database changes: Dropped and recreated login_attempt table

- **Testing Results**:
  - Login with valid credentials: Successfully works
  - Login attempts for invalid users: Properly tracked in database
  - Database integrity: Maintained with proper schema

### BUG-001: Example Critical Bug
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2023-05-10
- **Description**: This is an example critical bug that needs to be addressed immediately.

#### Implementation Notes
- **Issues Encountered**: 
  - [None yet]

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet]

### BUG-018: Persistent Module Resolution Linter Errors
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-05-09
- **Description**: The `permission.entity.ts` file (and potentially others) consistently shows linter errors such as "Cannot find module 'typeorm'" and "Cannot find module './action.entity'", despite `typeorm` being installed and `action.entity.ts` existing in the same directory. This issue is preventing the `schema-audit.ts` script from correctly building TypeORM entity metadata and may indicate a deeper problem with the TypeScript project setup, IDE caching, or module resolution that affects `ts-node` and TypeORM runtime reflection.

#### Implementation Notes
- **Symptoms**:
  - Linter errors in IDE for valid imports.
  - TypeORM metadata builder failing in standalone scripts (`schema-audit.ts`) with "Entity metadata for ... was not found" errors, likely due to inability to resolve related entity classes.
- **Potential Causes**:
  - IDE/Linter caching issues.
  - Node modules corruption.
  - Incorrect TypeScript or ts-node configuration/context.
  - Subtle pathing issues not immediately obvious from code.
  - TypeScript version conflicts.
- **Troubleshooting Steps Planned**:
  1. Verify `typeorm` and related dependencies are correctly listed in `package.json` and installed.
  2. Clean `node_modules` and `package-lock.json`, then reinstall.
  3. Check `tsconfig.json` for any misconfigurations (e.g., `paths`, `baseUrl`).
  4. Ensure `reflect-metadata` is imported early in entry points/scripts.
  5. Test simple `ts-node` execution of an entity file to isolate the issue.
  6. Compare TypeScript versions (global, local, IDE).

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet]

### BUG-019: Migration Scripts Misaligned with Actual SQLite Database Schema
- **Status**: Identified
- **Priority**: Critical
- **Testing**: Not Started
- **Added**: 2025-05-16
- **Description**: Early migration scripts (e.g., `1658012345678-CreatePermissionEntities.ts`) use PostgreSQL-specific DDL syntax (UUIDs as primary keys, `uuid_generate_v4()`, `now()` for timestamps). This has resulted in an actual SQLite database schema that significantly differs from the migrations' intent. Key discrepancies include INTEGER or VARCHAR primary keys instead of UUIDs, different default value mechanisms, and missing constraints. These misalignments cause subsequent migration failures (e.g., `SeedInitialPermissions1658012445678` failing on `frontend_routes` insert) and prevent reliable database schema management.

#### Technical Details & Investigation Findings:
- **Primary Key Mismatches**:
    - Migrations define `id` columns as `uuid PRIMARY KEY DEFAULT uuid_generate_v4()`.
    - Actual DB (SQLite) has `id` columns as `INTEGER PRIMARY KEY AUTOINCREMENT` (e.g., `permissions`, `roles`, `groups`, `ui_components`) or `VARCHAR PRIMARY KEY NOT NULL` (e.g., `frontend_routes`, `api_endpoints`). The `VARCHAR` PKs do not auto-generate, leading to insert failures.
- **Foreign Key Mismatches**:
    - FK columns in migrations are typed as `uuid` to match intended PKs.
    - Actual DB has these FKs as `INTEGER` to match the actual `INTEGER` PKs of referenced tables.
- **Default Value Generation**:
    - Migrations use `DEFAULT now()` (PostgreSQL).
    - Actual DB uses `DEFAULT CURRENT_TIMESTAMP` or `DEFAULT (datetime('now'))` (SQLite).
- **Problematic Table Examples from `1658012345678-CreatePermissionEntities.ts` analysis**:
    - `frontend_routes`: Migration `id uuid`, DB `id VARCHAR`. Caused `NOT NULL constraint failed: frontend_routes.id` in `SeedInitialPermissions1658012445678`.
    - `api_endpoints`: Migration `id uuid`, DB `id VARCHAR`. Missing `UNIQUE("method", "path")` constraint in DB.
- **Join Table Differences**:
    - Some join tables (e.g., `role_permissions`, `group_permissions`, `user_groups`) in the DB have a surrogate `id INTEGER PRIMARY KEY AUTOINCREMENT`, while the migration defines the PK as a composite of FKs.
- **Extraneous Columns**:
    - Tables like `group_permissions` and `user_groups` have additional columns in the DB (`granted`, `created_at`, `id` etc.) not defined in their initial creation migration (`1658012345678`), suggesting alterations by other processes or later unanalyzed migrations.
- **Root Cause**: Using DDL specific to one database system (PostgreSQL) in migrations that are run against a different database system (SQLite) without TypeORM correctly abstracting or the migrations conditionally handling these differences.

#### Impact:
- **Critical Migration Failures**: Prevents database from reaching a consistent, intended state. Blocks seeding of essential data.
- **Schema Unreliability**: The actual schema does not match the documented intent of early migrations.
- **Development Blocker**: Hinders resolution of other database-dependent bugs (e.g., aspects of BUG-018).
- **Data Integrity Risks**: Potential for unexpected behavior or data issues due to schema deviations.

#### Next Steps (High-Level Plan):
1.  **Systematic Migration Review (Complete as of 2025-05-16)**: Detailed analysis of all migration files against the current DB schema has been performed. Findings highlight systemic issues with PostgreSQL-specific DDL in early migrations and inconsistencies in table naming.
2.  **Formulate Correction Strategy (Decision: Standardize on INTEGER PKs for SQLite and Refactor Migrations)**:
    *   **Chosen Path**: Standardize on `INTEGER PRIMARY KEY AUTOINCREMENT` for all primary keys in SQLite. Align all migrations and entities to this standard. Plural table names will be used consistently.
    *   **Detailed Refactoring Plan**:
        1.  **Create New Migration for `actions` Table (Prerequisite)**:
            *   ID: (e.g., `1720000000000-CreateAndSeedActionsTable.ts` - use current unique timestamp)
            *   Purpose: Define and seed the `actions` table (`id INTEGER PK AUTOINCREMENT`, `action_name TEXT NOT NULL`, `description TEXT`, `category TEXT`, `UNIQUE(action_name, category)`). This is essential for the `permissions` table.
        2.  **Revise `1658012345678-CreatePermissionEntities.ts` (Core DDL)**:
            *   Change all PKs to `id INTEGER PRIMARY KEY AUTOINCREMENT`.
            *   Change FK columns to `INTEGER`.
            *   Use plural table names consistently (e.g., `permissions`, `roles`, `users`).
            *   Add `action_id INTEGER` FK (to `actions(id)`) to the `permissions` table.
            *   Convert `DEFAULT now()` to `DEFAULT (datetime('now'))`. Remove `CREATE EXTENSION`.
            *   Change `frontend_routes` and `api_endpoints` PKs to `INTEGER PRIMARY KEY AUTOINCREMENT`.
            *   Ensure SQLite-compatible `UNIQUE` constraints.
        3.  **Revise `1658012445678-SeedInitialPermissions.ts` (Core Seeding)**:
            *   Target plural table names. Omit `id` from `INSERT` for `AUTOINCREMENT` PKs.
            *   Seed `permissions` (including `action_id` based on seeded `actions`), `roles`, `groups`, `users`, `role_permissions`, `group_permissions`.
            *   Use SQLite-compatible timestamp defaults if needed.
        4.  **Handle `1679291200000-InitialSchema.ts` (Deprecate/Delete)**:
            *   This migration's DDL for singular `user`, `role`, `group` is superseded. Make it a no-op or delete.
            *   If the `task` table it creates IS actively used, move its (corrected) DDL to `1658012345678`. (DB currently has `task` with `id INTEGER PK`).
        5.  **Handle `1690000000000-CreateDynamicAccessControlTables.ts` (Deprecate/Refactor)**:
            *   Much of its DDL is superseded or incorrect (singular names, UUIDs). Make it a no-op or extract any unique, essential DDL (corrected for SQLite) into a new, clean migration or merge into `1658012345678`.
        6.  **Handle `1690000000001-SeedPermissionsData.ts` (Deprecate/Delete)**:
            *   Its seeding logic (for `permissions`, `roles`) should be merged into the revised `1658012445678`. Make this migration a no-op or delete.
        7.  **Review `1690000000002-CreateCacheSyncStatusTable.ts` (Keep As Is)**:
            *   SQLite-friendly DDL. Should run correctly after fixes.
        8.  **Review `1690000000003-FixSqliteTimestampIssues.ts` (Likely No-Op/Minor Tweak)**:
            *   Timestamp fixes are likely ineffective. Redundant `cache_sync_status` creation is fine. If its temp table DDL for `ui_components` (`id varchar PK`) ever triggers, it needs to be `INTEGER PK`. Can be kept or made a no-op.
        9.  **Revise `1711591600000-AddLoginMonitoringTables.ts` (Minor Edits)**:
            *   Change `ALTER TABLE "user"` to `ALTER TABLE "users"`.
            *   Ensure `login_attempt` FK is `REFERENCES "users" ("id")`. (DB already reflects this). DDL for new tables is otherwise good.
        10. **Database Reset & Full Migration Run**: After all revisions, delete `db.sqlite` and run all migrations fresh. Verify schema and data.
        11. **Update TypeORM Entities**: Align all `*.entity.ts` files with the corrected schema (number PKs, plural table names).
        12. **Update BUG-019 Documentation**: Record all decisions, deletions, and new migration details here in the backlog.
3.  **Implement Corrections**: (Next phase) Apply the above changes to the relevant migration files.

## High Priority Features
### FEAT-001: Example High Priority Feature
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2023-05-10
- **Description**: This is an example high priority feature that should be implemented soon.

#### Implementation Notes
- **Issues Encountered**: 
  - [None yet]

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet]

## Improvements
### IMP-001: Example Improvement
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2023-05-10
- **Description**: This is an example improvement that would enhance existing functionality.

#### Implementation Notes
- **Issues Encountered**: 
  - [None yet]

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet]

### IMP-002: Review and Update Dynamic Access Control Documentation
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-003
- **Added**: 2023-05-10
- **Description**: Following the project structure cleanup, comprehensive review of all dynamic access control documentation is needed to ensure consistency, update file paths, and verify examples point to the correct locations.

#### Implementation Notes
- **Issues Encountered**: 
  - [None yet]

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet]

### IMP-003: Complete ESLint Error Remediation
- **Status**: In Progress
- **Testing**: Not Started
- **Dependencies**: BUG-004
- **Added**: 2023-05-10
- **Description**: Address remaining ESLint errors throughout the codebase, focusing on type safety improvements and unused variable cleanup. Initial fixes have been made (BUG-004), but additional work is needed to resolve all linting issues.

#### Implementation Notes
- **Issues Encountered**: 
  - Current ESLint report shows ~198 remaining errors
  - Many "Unexpected any" type errors need proper typing

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet]

### IMP-004: Enhance Authentication Error Handling
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: BUG-003
- **Added**: 2023-05-10
- **Description**: Further enhance error handling in the authentication system, particularly around token refresh failures and network errors. Building on the logout method implementation (BUG-003), add more robust error recovery mechanisms.

#### Implementation Notes
- **Issues Encountered**: 
  - [None yet]

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet]

## Technical Debt
### TECH-001: Database Migration Scripts Implementation
- **Status**: Complete
- **Testing**: Passed
- **Dependencies**: None
- **Added**: 2023-05-10
- **Description**: Fix inconsistencies between entity definitions and database tables for ID types and relationships.

#### Implementation Notes
- **Issues Encountered**: 
  - Entity definitions and database tables had mismatched ID types
  - Role entity used UUID but should be numeric
  - Permission entity used UUID but should be numeric
  - RolePermission junction table had mixed ID types
  - Cache management had type issues in the RolesService
  - Missing fields and columns in various entities
  - Inconsistent column naming (camelCase vs snake_case)
  - Circular dependency issues in entity imports
  - ActionName vs action field inconsistency in Permission entity
  - Missing Action entity reference in Permission entity
  - Missing DTOs for action management
  - Duplicate entity definitions causing circular dependencies
  - Timestamp type not supported in SQLite

- **Files Modified**:
  - `angular/backend/src/database/data-source.ts`: 
    - Fixed import paths for entities to avoid circular dependencies
    - Added missing entities (Action, Resource)
    - Fixed incorrect entity paths
  - `angular/backend/src/modules/roles/entities/role.entity.ts`: 
    - Changed import path from absolute to relative for RolePermission
    - Updated column names to use snake_case format
    - Fixed import circular dependency
  - `angular/backend/src/modules/permissions/entities/permission.entity.ts`: 
    - Added actionName getter/setter for backward compatibility
    - Fixed relationship definitions with Action entity
    - Updated column names to use snake_case
    - Fixed mapping issue between action and actionName fields
    - Updated relationship references to use proper class syntax instead of strings
  - `angular/backend/src/modules/permissions/entities/group-permission.entity.ts`:
    - Updated entity definition with correct relationships
    - Added ID field as primary key
    - Standardized column names with snake_case
  - `angular/backend/src/modules/permissions/entities/user-permission.entity.ts`:
    - Updated entity definition with correct relationships
    - Added ID field as primary key
    - Standardized column names with snake_case
  - `angular/backend/src/modules/permissions/entities/action.entity.ts`: 
    - Created entity file with proper relationships to Permission
    - Added proper database column mapping with snake_case
    - Added bidirectional relationship with Permission entity
  - `angular/backend/src/modules/permissions/dtos/create-action.dto.ts`:
    - Created DTO for action creation with validation
  - `angular/backend/src/modules/permissions/dtos/update-action.dto.ts`:
    - Created DTO for action updates with validation
  - `angular/backend/src/modules/permissions/dtos/index.ts`:
    - Updated to export action DTOs
  - `angular/backend/src/modules/permissions/controllers/actions.controller.ts`:
    - Created controller for action management
    - Added CRUD operations with permission guards
  - `angular/backend/src/modules/permissions/services/permissions.service.ts`:
    - Added action management methods
    - Used Like operator for search functionality
    - Fixed type issues with repository queries
  - `angular/backend/src/modules/permissions/permissions.module.ts`:
    - Updated to include action components in module definition
    - Fixed import paths to avoid circular dependencies
  - `angular/backend/src/modules/users/entities/user.entity.ts`:
    - Updated import path for Group entity
    - Fixed Role entity import to use roles module version
  - `angular/backend/src/modules/users/entities/user-group.entity.ts`:
    - Updated import path for Group entity
    - Fixed column types for SQLite compatibility
  - `angular/backend/src/modules/permissions/entities/ui-component.entity.ts`:
    - Fixed datetime type for SQLite compatibility
  - `angular/backend/src/modules/permissions/entities/frontend-route.entity.ts`:
    - Fixed timestamp type for SQLite compatibility
  - `angular/backend/src/modules/permissions/entities/api-endpoint.entity.ts`:
    - Fixed timestamp type for SQLite compatibility
  - `angular/backend/src/modules/permissions/entities/component.entity.ts`:
    - Fixed timestamp type for SQLite compatibility
  - `angular/backend/src/migrations/1742536989655-CreateActionsTable.ts`:
    - Created migration for actions table
    - Added foreign key relationships to permissions table
  - `angular/backend/src/migrations/1742536989656-UpdatePermissionActionField.ts`:
    - Created migration for permission updates
    - Added action_name and action_id fields
    - Created backup functionality for safe rollbacks
  - Deleted duplicate entities:
    - `angular/backend/src/modules/permissions/entities/group.entity.ts`
    - `angular/backend/src/modules/permissions/entities/role.entity.ts`
    - `angular/backend/src/modules/permissions/entities/role-permission.entity.ts`

- **Testing Results**:
  - Entity structure aligns with database schema
  - Permission entity correctly maps to Action entity
  - Migration files successfully run without errors
  - Circular dependencies resolved
  - SQLite compatibility issues fixed
  - Entity relationships properly defined
  - Duplicate entities removed
  - Import paths corrected

### TECH-002: Complete Database Entity Type Standardization
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001
- **Added**: 2025-04-18
- **Description**: Follow-up to TECH-001 to address additional entity standardization issues that were identified during testing.

#### Implementation Notes
- **Issues Encountered**: 
  - CachePermissionMap entity still uses timestamp type which is not SQLite compatible
  - User-Permission relationship in User entity uses camelCase column names instead of snake_case
  - Potential duplicate component entities (component.entity.ts and ui-component.entity.ts)
  - Missing Resource entity relationship in Permission entity

- **Files to Modify**:
  - `angular/backend/src/modules/permissions/cache-entities/cache-permission-map.entity.ts`:
    - Fix timestamp type for SQLite compatibility by changing:
    ```typescript
    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    lastSynced: Date;
    ```
    to
    ```typescript
    @CreateDateColumn()
    lastSynced: Date;
    ```
  
  - `angular/backend/src/modules/users/entities/user.entity.ts`:
    - Standardize column names to snake_case in the JoinTable for user permissions:
    ```typescript
    @JoinTable({
      name: 'user_permissions',
      joinColumn: { name: 'user_id', referencedColumnName: 'id' },
      inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
    })
    ```
  
  - Evaluate whether to consolidate `component.entity.ts` and `ui-component.entity.ts`
  
  - `angular/backend/src/modules/permissions/entities/permission.entity.ts`:
    - Add relationship to Resource entity if necessary

- **Testing Results**:
  - [No tests run yet] 

### TECH-004: Implement Database Schema Audit Process
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-003
- **Added**: 2025-05-09
- **Description**: Develop a script to automatically audit and report discrepancies between the actual database schema (SQLite) and the TypeORM entity decorators. The database schema should be treated as the source of truth.

#### Implementation Notes
- **Requirements**:
  - Script should connect to the database.
  - Script should load TypeORM entity metadata.
  - Compare column names, nullability, and primary keys.
  - Report differences where the entity decorator doesn't match the database.
  - Initial focus on `Permission` entity, extendable to others.

- **Files Modified**:
  - [None yet]

- **Testing Results**:
  - [No tests run yet] 

### TECH-003.2: Schema Alignment Critical Fixes
- **Status**: Complete
- **Priority**: Critical
- **Testing**: Backend startup successful (pending confirmation from logs)
- **Dependencies**: TECH-003.1
- **Added**: 2025-05-09
- **Description**: Implement fixes for the most critical schema alignment issues that affect authentication and permissions functionality. Focus on ensuring `users`, `permissions`, and `roles` tables are correctly defined and populated.

#### Implementation Notes
- Manually added `CREATE TABLE IF NOT EXISTS "users"` to `direct-schema-fix.sql`.
- Executed `direct-schema-fix.sql` statements individually using `mcp_sqllite-python_query` to create/update `users`, `permissions`, `roles`, and `role_permissions` tables and seed initial data.
- Ensured `users` table has `is_active` column, `permissions` table has `resource_name` and `action`.
- Updated `Permission` and `Role` TypeORM entities to align `nullable` properties with the database schema.
- Backend server startup has been initiated to verify fixes.

#### Files Modified/Created
- `direct-schema-fix.sql`
- `angular/backend/src/modules/permissions/entities/permission.entity.ts`
- `angular/backend/src/modules/roles/entities/role.entity.ts`