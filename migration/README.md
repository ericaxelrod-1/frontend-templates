# Dynamic Role-Based Access Control Migration

This directory contains the migration resources for transitioning from hardcoded role-based access control to a dynamic, database-driven permission system with hierarchical roles and groups.

## Database Schema Changes

The `role-permission-schema.sql` file contains SQL migrations that make the following changes:

### Hierarchical Roles

- Adds a `parent_id` foreign key to the `role` table, allowing roles to inherit permissions from parent roles
- Creates a self-referential relationship with cascade updates and null on delete
- Adds indexes for performance optimization

### Resource-Action Permissions

- Creates a `resource` table to store application resources (e.g., users, groups, reports)
- Creates an `action` table with common actions (create, read, update, delete, list, manage)
- Creates a `permission` table linking resources to actions (e.g., "read:users", "update:groups")
- Sets up relationships between roles and permissions, groups and permissions, and users and permissions

### Hierarchical Groups

- Adds a `parent_id` foreign key to the `group` table, allowing groups to inherit permissions from parent groups
- Creates a self-referential relationship with cascade updates and null on delete
- Adds indexes for performance optimization

### Permission Resolution

- Creates an `effective_user_permissions` view that resolves all permissions for a user from:
  - Direct user permissions (highest priority)
  - Group permissions (medium priority)
  - Role permissions (lowest priority)
  - Inherited permissions from parent roles and groups
- Handles permission conflicts by using priority levels (user > group > role)

### Database Compatibility

- Includes PostgreSQL-specific and MySQL-specific sections to handle different syntax and reserved keywords
- Makes adjustments for each database system's unique features and constraints

## Using the Migration Script

1. Connect to your database:
   - PostgreSQL: `psql -U username -d database_name`
   - MySQL: `mysql -u username -p database_name`

2. Run the migration script:
   - PostgreSQL: `\i role-permission-schema.sql`
   - MySQL: `source role-permission-schema.sql`

3. Verify the changes:
   ```sql
   -- Check new tables
   SELECT * FROM resource;
   SELECT * FROM action;
   SELECT * FROM permission;
   
   -- Check role modifications
   DESCRIBE role;
   
   -- Check group modifications
   DESCRIBE "group"; -- PostgreSQL
   DESCRIBE `group`; -- MySQL
   ```

## Next Steps after Database Migration

1. Update the NestJS entities to reflect the new database structure
2. Create backend services for managing hierarchical roles, permissions, and groups
3. Update the role guard to use the permission system instead of hardcoded role checks
4. Implement frontend services for permission checks
5. Replace hardcoded role checks in frontend components with permission checks

## Benefits of the New System

- **Fine-grained Access Control**: Control access at the resource-action level rather than broad roles
- **Hierarchical Inheritance**: Roles and groups can inherit permissions from their parents
- **Dynamic Management**: Add, modify, or revoke permissions without code changes
- **User-level Overrides**: Grant or deny specific permissions to individual users regardless of their roles
- **Conflict Resolution**: Clear priority system for resolving permission conflicts
- **Performance Optimization**: Carefully designed indexes and views for efficient permission checks 