# Project Backlog

Last Updated: 2025-05-07

## High Priority

### TECH-001: Code Documentation Update
- **Status**: In Progress
- **Testing**: Passed (TECH-001.1), Not Started (TECH-001.2)
- **Dependencies**: None
- **Added**: 2025-04-30
- **Description**: Update code documentation for all scripts, ensuring consistent docstring format and comprehensive module-level documentation.

#### Implementation Notes
- TECH-001.1 (Documentation of Python scripts) completed on 2025-04-30
- TECH-001.2 (Test Suite Enhancement) still pending

- **Files Modified**:
  - `role_monitor.py`: Added detailed module documentation and improved function docstrings
  - `db_schema_validator.py`: Enhanced module description and function documentation
  - `validate_db.py`: Added comprehensive module and function documentation
  - `run_validator.py`: Improved description of commands and options
  - `role_utils_test.py`: Added detailed test case descriptions and parameter documentation

### TECH-001.3: Entity File Consolidation
- **Status**: In Progress
- **Testing**: In Progress
- **Dependencies**: None
- **Added**: 2025-04-28
- **Description**: Fix TypeScript compilation errors by consolidating entity files and fixing import paths.

#### Implementation Notes
- **2025-04-30**: 
  - Created symbolic link files to redirect entity imports
  - Fixed ID type mismatches (string/UUID to number)
  - Created database migrations for schema updates
  - Added missing methods in services
  - Implemented shared modules approach to solve circular dependencies:
    - Created UsersSharedModule, PermissionsSharedModule, AuthSharedModule
    - Created PermissionChecker interface and implementation
    - Updated module imports with forwardRef()
    - Used DI tokens for abstractions

- **Files Modified**:
  - src/modules/permissions/shared/permissions-shared.module.ts (new)
  - src/modules/users/shared/users-shared.module.ts (new)
  - src/modules/auth/shared/auth-shared.module.ts (new)
  - src/modules/permissions/shared/interfaces/permission-checker.interface.ts (new)
  - src/modules/permissions/services/permission-checker.service.ts (new)
  - src/modules/permissions/permissions.module.ts
  - src/modules/users/groups.service.ts
  - src/modules/cache/cache.module.ts
  - src/modules/cache/cache-sync.service.ts
  - src/app.module.ts

- **Testing Results**:
  - TypeScript errors reduced from 119 to 0
  - Database schema synchronization fixed with SQLite-specific migration

## Medium Priority

### TECH-002: Tool Enhancements
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001
- **Added**: 2025-04-30
- **Description**: Improve existing schema validation and role monitoring tools with better error reporting, visualization, and additional analytics features.

### TECH-002.1: Schema Validation Improvements
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.1, TECH-001.2
- **Added**: 2025-04-28
- **Description**: Improve error reporting and user experience for schema validation tools.

### TECH-002.2: Role Monitoring Enhancements
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.1, TECH-001.2
- **Added**: 2025-04-28
- **Description**: Add additional analytics features to the role monitoring tools.

### FEAT-001: Role Hierarchy Management
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.3
- **Added**: 2025-04-28
- **Description**: Implement role hierarchy management system.

## Low Priority

### TECH-004.1: Continuous Integration Setup
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.2, TECH-001.3
- **Added**: 2025-04-28
- **Description**: Set up automated testing and continuous integration.

### TECH-004.2: Deployment Pipeline
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-004.1
- **Added**: 2025-04-28
- **Description**: Create deployment pipeline for tools and applications.

### FEAT-002: Permission Auditing
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: TECH-001.3, FEAT-001
- **Added**: 2025-04-28
- **Description**: Add permission auditing to track changes.

### TASK-004: Align Database Schema, Documentation, and Migrations
- **Status**: Complete
- **Testing**: Passed
- **Dependencies**: TECH-003, TECH-003.1, TECH-003.2, BUG-015
- **Added**: 2025-05-07
- **Completed**: 2025-05-13
- **Description**: Align all database schema, migration scripts, and documentation with TypeORM entity definitions. Condense migration scripts, fix all table naming and foreign key issues, and ensure all seed scripts work as expected.

#### Implementation Notes
- All schema alignment and table naming issues resolved by TASK-004. See changelog for details.

#### Migration Script Condensation Progress (2025-05-13)

- **Completed:** Condensed and updated migration scripts for all tables:
  - users
  - roles
  - permissions
  - role_permissions
  - group_permissions
  - user_permission
  - user_groups
  - ui_components
  - frontend_routes
  - api_endpoints
  - task
  - category
  - tag
  - resource
  - login_attempt
  - user_roles
  - ui_component_permissions
  - frontend_route_permissions
  - api_endpoint_permissions
  - task_tags_tag
  - group_permission
  - migrations
  - captcha
  - migrations_history
  - ip_reputation
- **Scripts condensed:**
  - 1742536989658-FixPermissionAndRolePermissionsSchema.ts
  - 1742536989660-FixPermissionsTableColumns.ts
  - 1742536989661-FixPermissionsTableMissingColumns.ts
  - 1684156802000-fix-role-permissions.ts
  - 1720000000004-CreateRolesTable.ts
  - 1720000000005-ConvertRoleIdToNumeric.ts
  - 1720000000006-ConvertPermissionIdToNumeric.ts
  - 1720000000100-UpdatePermissionEntity.ts
  - 1690000000000-CreateDynamicAccessControlTables.ts (partial)
  - 1720000000102-AddPermissionRelationshipTables.ts
  - 1742536989662-DirectAddMissingColumns.ts
  - 1742536989657-FixSQLiteCompositePrimaryKeys.ts
- **All redundant scripts ready for archiving/removal.**
- **All migration scripts are now fixed and up to date.**

#### Migration Script Coverage Checklist (2025-05-13)

- For each table below, ensure there is exactly one migration script that matches the current schema (columns, types, constraints, PKs, FKs).
- If multiple scripts affect the same table, condense into a single, clear migration as recommended.

**Tables and Actions:**

- **users**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **roles**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **groups**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **permissions**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **actions**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **role_permissions**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **user_permission**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **group_permissions**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **user_groups**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **ui_components**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **frontend_routes**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **api_endpoints**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **task**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **category**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **tag**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **resource**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **login_attempt**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **user_roles**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **ui_component_permissions**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **frontend_route_permissions**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **api_endpoint_permissions**
  - Migration script(s) present: Yes
  - Overlapping migrations: Yes
  - Action: Condense into a single migration matching the current schema

- **task_tags_tag**
  - Migration script(s) present: ?
  - Overlapping migrations: ?
  - Action: Add migration if missing; update if needed

- **group_permission**
  - Migration script(s) present: ?
  - Overlapping migrations: ?
  - Action: Add migration if missing; update if needed

- **migrations**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **captcha**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **migrations_history**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

- **ip_reputation**
  - Migration script(s) present: Yes
  - Overlapping migrations: ?
  - Action: Verify migration matches current schema; update if needed

**General Recommendation:**
- For each table with overlapping migrations, condense into a single migration script that creates the table with the full, current schema and all constraints.
- For any table missing a migration, add a new migration script.
- After condensing and updating, verify all migrations run cleanly and match the TypeORM entity definitions and the live database schema.

#### Implementation Notes:
- SQLite MCP tools are to be used for all direct DDL changes in Phase 1.
- The TypeORM entity definitions in the project codebase are the ultimate source of truth for schema structure.
- Data in tables that are dropped and recreated will be lost; the `npm run db:seed` script is expected to repopulate necessary initial data.
- Careful verification is needed after each DDL operation in Phase 1.

#### Open Questions/Risks:
- The `npm run db:seed` script itself might have issues if it expects data or schema states that are changing (e.g., it failed previously due to missing `username` in its seed data for users). This script may need adjustments once the schema is stable (though this task aims to avoid code changes to the app itself initially).
- If the `migration:generate` command continues to produce unexpected diffs even after thorough Phase 1 alignment, it might indicate a more obscure issue with TypeORM's schema diffing logic for SQLite or a subtle remaining inconsistency. 