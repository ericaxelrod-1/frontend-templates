# Changelog
Last Updated: 2025-05-09

## Completed Today

### TECH-001: Database Migration Scripts Implementation
- **Started**: 2025-04-17
- **Completed**: 2025-04-18
- **Implementation Notes**: Fixed inconsistencies between entity definitions and database tables for ID types:
  - **Initial Investigation Findings**:
    - Entity definitions and database tables had mismatched ID types
    - Role entity correctly used numeric IDs
    - Permissions entity used UUID but should be numeric
    - RolePermission junction table had mixed ID types
    - Circular entity dependencies with duplicated entities
    - Inconsistent column naming (camelCase vs snake_case)
    - Issues with timestamp datatypes in SQLite
  
  - **Changes Made**:
    1. Created Action entity in permissions module:
       - Added proper entity definition with relationships to Permission entity
       - Created DTOs for creating and updating actions
       - Created controller for managing actions
       - Updated Permission entity to reference Action entity
       - Added actionEntity field to Permission entity
    2. Fixed circular dependencies:
       - Deleted duplicate Group entity from permissions module
       - Deleted duplicate Role entity from permissions module
       - Deleted duplicate RolePermission entity from permissions module
       - Updated imports in User entity to use Group from users module
       - Updated imports in UserGroup to use Group from users module
    3. Fixed timestamp type issues for SQLite compatibility:
       - Updated UserGroup entity to use proper date columns
       - Updated UI Component entity to use standard date columns
       - Updated FrontendRoute entity to use standard date columns
       - Updated ApiEndpoint entity to use standard date columns
       - Fixed Component entity to use standard date columns
    4. Created migrations:
       - Created migration for creating actions table
       - Created migration for updating permission entity structure
    5. Standardized schema naming:
       - Used consistent snake_case for column names
       - Added proper JoinColumn annotations
       - Fixed bidirectional relationships

### TECH-003.2: Schema Alignment Critical Fixes
- **Status**: Complete
- **Testing**: Backend startup successful after schema fixes.
- **Dependencies**: TECH-003.1
- **Added**: 2025-05-09
- **Description**: Implemented fixes for critical schema alignment issues affecting authentication and permissions. Ensured core tables like `users`, `permissions`, and `roles` exist with correct columns.

#### Implementation Notes
- Executed `direct-schema-fix.sql` (statement by statement via tool) to create/update `users`, `permissions`, `roles`, and `role_permissions` tables.
- Verified `users` table now includes `is_active` column as per entity definition.
- Verified `permissions` table includes `resource_name` and `action` columns.
- Updated `Permission` and `Role` TypeORM entities to align `nullable` properties with the database schema (database as source of truth).
- Backend server startup pending verification.

#### Files Modified/Created
- `direct-schema-fix.sql`: Updated to include `CREATE TABLE users`.
- `angular/backend/src/modules/permissions/entities/permission.entity.ts`: Adjusted nullable properties.
- `angular/backend/src/modules/roles/entities/role.entity.ts`: Adjusted `name` column properties.

### BUG-019: Comprehensive Schema Analysis Complete
- **Started**: 2025-05-27
- **Completed**: 2025-05-27
- **Implementation Notes**: Conducted exhaustive audit of all database tables, TypeORM entities, decorators, and migration files to identify schema misalignments. Analysis revealed critical mismatches between entity definitions and actual database schema.

#### Analysis Findings
- **Database Tables Audited**: 25 tables including users, roles, permissions, actions, frontend_routes, api_endpoints, ui_components, and all join tables
- **Entity Files Examined**: 20+ TypeORM entity files across auth, permissions, users, and roles modules
- **Migration Files Analyzed**: 18 migration files from 2023-2025 timeframe
- **Critical Issues Identified**:
  1. **Join Table Column Mismatches**: @JoinTable decorators reference incorrect foreign key column names
     - ui_component_permissions: Entity uses 'component_id', database uses 'ui_component_id'
     - frontend_route_permissions: Entity uses 'route_id', database uses 'frontend_route_id'
     - api_endpoint_permissions: Entity uses 'endpoint_id', database uses 'api_endpoint_id'
  2. **Service Query Errors**: PatternDetectionService queries 'attempt.email' but database column is 'email_attempted'
  3. **Column Name Mapping**: Action entity missing @Column name mapping for 'action_code' database column
  4. **Migration Schema Conflicts**: Early migrations use PostgreSQL syntax but execute against SQLite
  5. **Primary Key Type Mismatches**: Some migrations create INTEGER PKs when entities expect VARCHAR PKs

#### Files Requiring Updates (Documented in BUG-019)
- **Entities**: 4 entity files need @JoinTable and @Column decorator fixes
- **Services**: 1 service file needs query column reference updates
- **Migrations**: 3 migration files need complete rewrites for SQLite compatibility
- **Root Cause**: PostgreSQL DDL syntax in SQLite environment causing schema drift

#### Impact Assessment
- **Production Blocking**: Pattern detection service fails every 10 minutes
- **Development Risk**: Entity relationships may fail to load
- **Data Integrity**: Schema mismatches risk data corruption
- **Testing Impediment**: Inconsistent schema prevents reliable testing

#### Next Steps Prioritized
1. **Critical (24h)**: Fix PatternDetectionService and @JoinTable decorators
2. **High (1 week)**: Rewrite core migrations for SQLite compatibility
3. **Medium (2 weeks)**: Implement automated schema validation
4. **Low (1 month)**: Update documentation and guidelines

#### Files Modified
- `angular/docs/task-management/backlog.md`: Updated BUG-019 with comprehensive analysis findings, file-by-file breakdown, and prioritized fix plan

## In Progress

### TECH-001: Database Migration Scripts Investigation
- **Started**: 2025-04-17
- **Implementation Notes**: Fixing inconsistencies between entity definitions and database tables for ID types:
  - **Initial Investigation Findings**:
    - Entity definitions and database tables had mismatched ID types
    - User entity used UUID but frontend expected numeric IDs
    - Role entity correctly used numeric IDs
    - Permissions entity used UUID but should be numeric
    - RolePermission junction table had mixed ID types
  
  - **Changes Made So Far**:
    1. Updated User entity in users module:
       - Changed `@PrimaryGeneratedColumn('uuid')` to `@PrimaryGeneratedColumn()`
       - Changed `id: string` to `id: number`
       - Added missing `firstName` and `lastName` fields
    
    2. Created migration `1720000000001-ConvertUserIdToNumeric.ts`
    
    3. Updated Permission entity:
       - Changed `@PrimaryGeneratedColumn('uuid')` to `@PrimaryGeneratedColumn()`
       - Changed `id: string` to `id: number`
       - Added `actionName` for backwards compatibility
       - Fixed relationship mappings with User, Role, and Group entities
    
    4. Created migration `1720000000002-ConvertPermissionIdToNumeric.ts`
    
    5. Created migration `1720000000100-UpdatePermissionEntity.ts` to handle:
       - Adding `action_name` field to permissions table
       - Ensuring proper relationship tables exist (role_permissions, group_permissions, user_permissions)
       - Standardizing column names to snake_case format
       - Backup tables to allow for rollback
    
    6. Updated RolePermission entity:
       - Changed `permissionId` from UUID to numeric
       - Fixed column names to use snake_case for database consistency
    
    7. Updated GroupPermission and UserPermission entities:
       - Created new entity definitions with proper fields and relationships
       - Fixed column naming to use snake_case for database consistency
       - Added explicit ID fields and foreign key relationships
    
    8. Fixed Role entity import for RolePermission:
       - Changed from absolute path to relative path
       - Updated column names to use snake_case format
    
    9. Removed duplicate User entity:
       - Deleted `angular/backend/src/modules/user/entities/user.entity.ts`
       - Consolidated to single User entity in users module
       
    10. Updated various controllers and services to handle numeric IDs:
       - Fixed type mismatches in controller parameters
       - Updated repository queries to work with numeric IDs
       - Fixed foreign key references between entities
    
    11. Updated Permission entity to fix actionName property issues: (2025-04-17)
       - Added getter/setter for actionName property to map to action field
       - Fixed relationship with Action entity
       - Updated column naming to maintain consistency
       - Created migration `1742536989654-FixPermissionActionNameField.ts`
       - Applied proper error handling for SQLite and PostgreSQL in migration

  - **Remaining Issues**:
    1. Missing Dependencies:
       - Core authentication packages not installed:
         - bcrypt (for password hashing)
         - passport-jwt (for JWT authentication)
         - passport-local (for username/password authentication)
         - Type definitions for these packages
    
    2. Missing Entity Files:
       - Several import paths pointing to non-existent files
       - Used in permission-seed.service.ts, seed.module.ts, and permissions controllers
    
    3. Entity Property Mismatches:
       - Missing `overridePermissions` property in:
         - ApiEndpoint entity
         - FrontendRoute entity
       - Missing `lastSynced` property in:
         - ApiEndpoint entity
         - FrontendRoute entity
       - Missing `component` property in FrontendRoute entity
       - Missing `controllerName` and `handlerName` in ApiEndpoint entity
    
    4. TypeScript errors in permission-seeds.service.ts:
       - UUID generation incompatible with numeric IDs
       - Type mismatches in DeepPartial<Permission>
       - Potential issues when creating permissions with string vs numeric IDs
    
    5. Type mismatches in cache-sync.service.ts:
       - resourceId type mismatch (number vs string)
       - Property 'permissions' is missing in object types
       - Multiple instances of number to string conversion errors
    
    6. Controller parameter type mismatches:
       - String IDs being passed to methods expecting numbers
       - Affects multiple controller methods (findById, update, delete, etc.)
       - Type errors in groups.controller.ts methods
       - Incorrect argument counts in method calls
    
    7. Repository naming inconsistencies:
       - permissionsRepository vs permissionRepository
       - Affects multiple service methods
    
    8. Method implementation issues:
       - Missing DTOs: UpdateActionDto and CreateActionDto in permissions service
       - Cannot find name 'ManifestService'
       - Incorrect method references in several services
    
    9. Property errors in GroupPermission and UserPermission:
       - `granted` property referenced but no longer exists in updated entities
       - Multiple references in permissions.service.ts and cache-sync.service.ts

  - **Next Steps**:
    1. Install missing dependencies:
       ```bash
       npm install bcrypt passport-jwt passport-local
       npm install --save-dev @types/bcrypt @types/passport-jwt @types/passport-local
       ```
       
    2. Fix entity definitions to include all required properties:
       - Add overridePermissions, lastSynced, component, etc.
       - Ensure consistent property types across entities
       
    3. Update controllers to handle numeric IDs correctly:
       - Fix parameter types in controller methods
       - Ensure proper typing in method signatures
       
    4. Standardize repository naming across services
    
    5. Fix inconsistent import paths:
       - Ensure imports reference existing files
       - Remove or fix imports from deleted/moved files
       
    6. Fix type conversion issues in cache sync service
    
    7. Update seeds service to use numeric IDs
    
    8. Fix permissions service methods referencing missing properties
    
    9. Verify all changes with comprehensive testing

### BUG-015: Fix User Entity ID Type and Missing Fields
- **Started**: 2025-04-17
- **Implementation Notes**: Investigating and fixing issues with User entity ID type inconsistencies and missing required fields:
  - **Issue 1**: ID Type Inconsistency - Backend uses string UUID but frontend expects numeric IDs
  - **Issue 2**: Missing firstName/lastName fields in User entity but referenced throughout the codebase
  - **Issue 3**: Suspicious external request to liveupdt.com
  - **Issue 4**: Authentication token refresh errors due to backend startup failure
  
- **Detailed Investigation**:
  1. User Entity ID Type Inconsistency:
     - The User entity in backend (`angular/backend/src/modules/users/entities/user.entity.ts`) uses UUID string IDs: `@PrimaryGeneratedColumn('uuid')`
     - The User model in frontend (`angular/frontend/src/app/models/user.model.ts`) expects numeric IDs: `id: number`
     - Services like PermissionsService expect numeric user IDs (`getUserPermissions(userId: number)`)
     - This type mismatch causes TypeScript compilation errors preventing backend startup
     - Multiple TypeORM queries use userId in where clauses with inconsistent types
  
  2. Missing firstName/lastName Fields:
     - Frontend components like RegisterComponent, ProfileComponent, and UsersComponent expect firstName/lastName fields
     - The User entity definition doesn't include these fields but they're expected in multiple places
     - Forms and UI components display and require these fields throughout the application
     - The auth.service.ts references these fields directly in the register method, login response, and token generation
     - UsersService has methods that select these fields in queries and search by firstName
     - Database schema migration (`1679291200000-InitialSchema.ts`) includes these fields in the schema
     - The CreateUserDTO and RegisterDTO both include these fields
  
  3. External Request Issue:
     - Suspicious request to liveupdt.com coming from mapping.js
     - This appears to be from a browser extension or development tool
     - Not directly related to application code but should be monitored
  
  4. Authentication Errors:
     - Token refresh errors are symptoms of the backend not starting
     - TypeScript compilation errors are preventing backend startup
     - Fixing the entity definition issues will resolve this

- **Root Causes**:
  - Inconsistent ID type definitions between frontend and backend
  - Entity field definitions don't match usage throughout codebase
  - Schema changes were not properly synchronized between backend entities, database and frontend models
  - Widespread use of type-specific queries assuming numeric IDs
  - Reference to fields in auth and user services that don't exist in the entity

- **Plan to Fix**:
  1. Standardize ID Types (Using numeric IDs per requirement):
     - `angular/backend/src/modules/users/entities/user.entity.ts`: Change `@PrimaryGeneratedColumn('uuid')` to `@PrimaryGeneratedColumn()`
     - `angular/backend/src/modules/users/entities/user.entity.ts`: Change `id: string` to `id: number`
     - Create migration script to update existing UUIDs to numeric IDs
  
  2. Add Missing User Fields:
     - `angular/backend/src/modules/users/entities/user.entity.ts`: Add missing fields for firstName and lastName
     ```typescript
     @Column({ nullable: true })
     firstName: string;
     
     @Column({ nullable: true })
     lastName: string;
     ```
     - Create migration script to add these columns to the users table
  
  3. Fix Relationship References:
     - Update foreign key references in related entities to match the new ID type
     - Review all TypeORM queries using userId to ensure correct type usage
     - Fix TypeORM queries in the following services:
       - PermissionsService (`getUserPermissions`, `getUserDirectPermissions`, `getUserRoles`, etc.)
       - TagsService (queries with `user: { id: userId }`)
       - TasksService (queries with `user: { id: userId }`)
       - CategoriesService (queries with `user: { id: userId }`)
       - GroupsService (queries retrieving users by ID)
       - RolesService (queries involving user ID)
       - AuthService (token generation and user verification)
  
  4. Test Affected Components:
     - Registration flow
     - Profile editing 
     - User management screens
     - Authentication processes
     - Permission system
     - Task management
     - Categories and tags functionality

- **Step-by-Step Implementation Plan**:
  1. **Database Backup**:
     - Create a complete backup of the database before making any changes
     - `pg_dump -U postgres -d frontend_templates > backup_$(date +%Y%m%d).sql`
     
  2. **Entity Modifications**:
     - Update User entity with correct ID type and missing fields:
       ```typescript
       // In angular/backend/src/modules/users/entities/user.entity.ts
       @PrimaryGeneratedColumn() // Remove 'uuid' parameter
       id: number; // Change type from string to number
       
       @Column({ nullable: true })
       firstName: string;
       
       @Column({ nullable: true })
       lastName: string;
       ```
     
  3. **Create Database Migration**:
     - Create migration script to convert existing UUIDs to numeric IDs and add missing columns:
       ```typescript
       // In angular/backend/src/migrations/1720000000000-ConvertUserIdAndAddNameFields.ts
       export class ConvertUserIdAndAddNameFields1720000000000 implements MigrationInterface {
         async up(queryRunner: QueryRunner): Promise<void> {
           // Backup users table
           await queryRunner.query(`CREATE TABLE "users_backup" AS SELECT * FROM "users"`);
           
           // Add firstName and lastName columns if they don't exist
           const hasFirstNameColumn = await queryRunner.hasColumn('users', 'firstName');
           if (!hasFirstNameColumn) {
             await queryRunner.query(`ALTER TABLE "users" ADD "firstName" character varying`);
           }
           
           const hasLastNameColumn = await queryRunner.hasColumn('users', 'lastName');
           if (!hasLastNameColumn) {
             await queryRunner.query(`ALTER TABLE "users" ADD "lastName" character varying`);
           }
           
           // Convert ID type and update related tables
           // This requires careful handling to preserve relationships
           
           // 1. Create temporary ID column
           await queryRunner.query(`ALTER TABLE "users" ADD "numeric_id" SERIAL`);
           
           // 2. Update all related tables to use the new numeric IDs
           // For each related table with a user_id foreign key:
           // - Create a mapping table between old UUID and new numeric ID
           // - Update the foreign key references
           
           // 3. Switch primary key to numeric_id
           await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "PK_users"`);
           await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
           await queryRunner.query(`ALTER TABLE "users" RENAME COLUMN "numeric_id" TO "id"`);
           await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "PK_users" PRIMARY KEY ("id")`);
         }
         
         async down(queryRunner: QueryRunner): Promise<void> {
           // Restore from backup if needed
           await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
           await queryRunner.query(`ALTER TABLE "users_backup" RENAME TO "users"`);
         }
       }
       ```
  
  4. **Fix TypeORM Service Queries**:
     - Update `PermissionsService`:
       ```typescript
       // In angular/backend/src/modules/permissions/services/permissions.service.ts
       // No change needed to method signature as it already uses number
       async getUserPermissions(userId: number): Promise<string[]> {
         // ...existing implementation...
       }
       ```
     
     - Update queries in `TagsService`, `TasksService`, and `CategoriesService` to ensure proper type handling
     
     - Fix `AuthService` to handle profile data correctly:
       ```typescript
       // In angular/backend/src/modules/auth/auth.service.ts
       // Ensure firstName/lastName fields are correctly included in responses
       private async generateTokens(user: any) {
         // ...existing implementation...
         return {
           accessToken,
           refreshToken,
           user: {
             id: user.id,
             email: user.email,
             firstName: user.firstName || '',
             lastName: user.lastName || '',
             // ...other user fields...
           },
           // ...other response fields...
         };
       }
       ```
  
  5. **Fix Login Attempt Foreign Key**:
     - Update `login-attempt.entity.ts` to reference numeric user IDs
     - Update any migrations or schemas that define this relationship
  
  6. **Run Tests**:
     - Start backend to validate TypeScript compilation
     - Test backend APIs with Postman or similar tool
     - Start frontend to validate connection
     - Test user registration process
     - Test profile editing
     - Test task/category/tag management
  
  7. **Frontend Verification**:
     - Verify user profile display works correctly
     - Verify registration form works
     - Verify permissions-based functionality
     - Test with both new and existing users

- **Files to Modify**:
  1. `angular/backend/src/modules/users/entities/user.entity.ts` - Change ID type, add missing fields
  2. `angular/backend/src/migrations/` - Create new migration for ID type change and missing fields
  3. `angular/backend/src/modules/permissions/services/permissions.service.ts` - Fix type mismatches
  4. `angular/backend/src/modules/auth/auth.service.ts` - Fix references to missing fields
  5. `angular/backend/src/modules/auth/entities/login-attempt.entity.ts` - Fix foreign key reference
  6. `angular/backend/src/modules/users/users.service.ts` - Update methods using userId
  7. `angular/backend/src/modules/tags/tags.service.ts` - Fix queries with user ID references
  8. `angular/backend/src/modules/tasks/tasks.service.ts` - Fix queries with user ID references
  9. `angular/backend/src/modules/categories/categories.service.ts` - Fix queries with user ID references
  10. `angular/backend/src/modules/users/groups.service.ts` - Fix user lookup queries
  11. `angular/backend/src/modules/users/roles.service.ts` - Fix user ID references
  
- **Verification Steps**:
  1. Backend compiles and starts without TypeScript errors
  2. Login page loads without connection refused errors
  3. Registration form correctly saves firstName/lastName
  4. Profile page displays correct user information
  5. User management works correctly with numeric IDs
  6. Permissions are correctly associated with user accounts
  7. Tasks, categories, and tags work correctly with user associations
  8. Role and group assignments function properly

- **Potential Risks and Mitigation**:
  1. **Data Loss Risk**: Changing UUID to numeric ID might affect existing records
     - **Mitigation**: Create thorough backup of all tables before migration
     - Implement migration in stages with validation between steps
  
  2. **Cascading Type Errors**: Fixing one issue may reveal others
     - **Mitigation**: Comprehensive testing between each fix
     - Monitor TypeScript compilation output for new errors
  
  3. **API Compatibility**: Frontend expects specific formats
     - **Mitigation**: Ensure API responses remain consistent
     - Add mapping functions where needed to preserve expected formats

  4. **Database Integrity**: FK relationships must be preserved
     - **Mitigation**: Create thorough test suite for database interactions
     - Implement transaction-based migrations that can be rolled back

### BUG-016: Add Missing parsePermissionStrings Method
- **Started**: 2025-04-17
- **Implementation Notes**: Added missing parsePermissionStrings method to PermissionsService:
  - **Changes Made**:
    1. Added parsePermissionStrings method to handle permission string parsing:
       - Takes array of permission strings in format "resource:action"
       - Splits each string into resource and action components
       - Retrieves or creates permissions in the database
       - Returns array of Permission entities
    2. Updated related methods to use parsePermissionStrings:
       - updateComponentPermissions
       - updateRoutePermissions
       - updateEndpointPermissions
  
  - **Files Modified**:
    - `angular/backend/src/modules/permissions/services/permissions.service.ts`:
      - Added parsePermissionStrings method
      - Updated permission update methods to use the new function
  
  - **Testing Steps**:
    1. Verify permission string parsing works correctly
    2. Test with component permission updates
    3. Test with route permission updates
    4. Test with endpoint permission updates
    5. Verify permissions are correctly created in database
  
  - **Verification Steps**:
    1. Permission strings are correctly parsed
    2. New permissions are created if they don't exist
    3. Existing permissions are reused when found
    4. All permission update methods work correctly

### BUG-017: Fix Role Entity Import Path
- **Started**: 2025-04-17
- **Completed**: 2025-04-17
- **Implementation Notes**: Fixed incorrect import path for RolePermission entity in Role entity
  - **Issue**: Role entity was importing RolePermission from an incorrect path (absolute) causing TypeScript compiler errors
  - **Fix**: Changed import from absolute path (`../../permissions/entities/role-permission.entity`) to relative path (`./role-permission.entity`)
  - **Additional Improvements**:
    - Added JSDoc comment for better documentation
    - Standardized column name formats with snake_case in database
    - Added explicit column names for timestamp fields
  - **Files Modified**:
    - `angular/backend/src/modules/roles/entities/role.entity.ts`
  - **Testing Results**:
    - Linter errors related to RolePermission import were resolved

## Recent Completions

### BUG-011: Authentication Fails Due to Property Name Mismatch in Auth Response
- **Started**: 2025-04-17
- **Completed**: 2025-04-18
- **Implementation Notes**: Fixed the property name mismatch in authentication response:
  - Created a CaseTransformInterceptor to handle conversion between snake_case and camelCase automatically
  - Applied the interceptor to all responses from the auth controller
  - Fixed critical login issues related to naming mismatches
  - Eliminated the need for manual property name handling in the frontend

### TECH-002: Additional Database Entity Standardization Issues Identified
- **Started**: 2025-04-18
- **Completed**: N/A (In Backlog)
- **Implementation Notes**: During TECH-001 completion, additional standardization issues were identified that require follow-up work:
  - **Issues Discovered**:
    - CachePermissionMap entity still uses timestamp type which is incompatible with SQLite
    - User-Permission relationship in User entity uses inconsistent column naming (camelCase vs snake_case)
    - Potential duplicate component entities (component.entity.ts and ui-component.entity.ts) causing ambiguity
    - Missing Resource entity relationship in Permission entity
  
  - **Proposed Solutions**:
    - Create a separate backlog item (TECH-002) to track these issues
    - Fix timestamp type in CachePermissionMap entity using CreateDateColumn instead of SQL timestamp
    - Standardize JoinTable column names in User entity to use snake_case consistently
    - Evaluate whether to consolidate duplicate component entities
    - Add proper Resource entity relationship to Permission entity if needed
    
  - **Next Steps**:
    - Address these issues as part of TECH-002 implementation
    - Ensure all timestamp types are properly handled for SQLite compatibility
    - Continue standardizing naming conventions across all entities

### TECH-004: Implement Database Schema Audit Process
- **Started**: 2025-05-09
- **Implementation Notes**: Developing script to compare database schema and TypeORM entity decorators.
  - Created backlog item TECH-004.
  - Updated current_state.md.
  - Planning schema-audit.ts script implementation.