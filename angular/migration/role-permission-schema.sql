-- Migration script for hierarchical roles and permissions
-- This script updates the existing role structure to support hierarchical roles and granular permissions

-- Step 1: Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resource, action)
);

-- Step 2: Create role_hierarchy table for parent-child relationships
CREATE TABLE IF NOT EXISTS role_hierarchy (
    parent_role_id INT NOT NULL,
    child_role_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_role_id, child_role_id),
    FOREIGN KEY (parent_role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (child_role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CHECK (parent_role_id != child_role_id) -- Prevent self-reference
);

-- Step 3: Create role_permissions join table
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- Step 4: Add hierarchical fields to roles table
ALTER TABLE roles 
ADD COLUMN IF NOT EXISTS level INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;

-- Step 5: Create groups table if not exists
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 6: Create group_hierarchy table for parent-child relationships
CREATE TABLE IF NOT EXISTS group_hierarchy (
    parent_group_id INT NOT NULL,
    child_group_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_group_id, child_group_id),
    FOREIGN KEY (parent_group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (child_group_id) REFERENCES groups(id) ON DELETE CASCADE,
    CHECK (parent_group_id != child_group_id) -- Prevent self-reference
);

-- Step 7: Create group_permissions join table
CREATE TABLE IF NOT EXISTS group_permissions (
    group_id INT NOT NULL,
    permission_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, permission_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- Step 8: Create user_groups join table
CREATE TABLE IF NOT EXISTS user_groups (
    user_id INT NOT NULL,
    group_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Step 9: Create direct user permissions (for exceptions)
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INT NOT NULL,
    permission_id INT NOT NULL,
    granted BOOLEAN DEFAULT TRUE, -- TRUE = grant, FALSE = deny (override)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, permission_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- Step 10: Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_role_hierarchy_parent ON role_hierarchy(parent_role_id);
CREATE INDEX IF NOT EXISTS idx_role_hierarchy_child ON role_hierarchy(child_role_id);
CREATE INDEX IF NOT EXISTS idx_group_permissions_group_id ON group_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_permissions_permission_id ON group_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_group_hierarchy_parent ON group_hierarchy(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_group_hierarchy_child ON group_hierarchy(child_group_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_groups_user_id ON user_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_user_groups_group_id ON user_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_permissions_resource_action ON permissions(resource, action);

-- Step 11: Create views for easier querying
CREATE OR REPLACE VIEW effective_role_permissions AS
WITH RECURSIVE role_tree AS (
    -- Base case: direct parent-child relationships
    SELECT parent_role_id, child_role_id
    FROM role_hierarchy
    
    UNION
    
    -- Recursive case: traverse up the hierarchy
    SELECT h.parent_role_id, t.child_role_id
    FROM role_hierarchy h
    JOIN role_tree t ON h.child_role_id = t.parent_role_id
)
SELECT DISTINCT r.id AS role_id, p.id AS permission_id, p.resource, p.action
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id

UNION

SELECT DISTINCT rt.child_role_id AS role_id, p.id AS permission_id, p.resource, p.action
FROM role_tree rt
JOIN role_permissions rp ON rt.parent_role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id;

CREATE OR REPLACE VIEW effective_group_permissions AS
WITH RECURSIVE group_tree AS (
    -- Base case: direct parent-child relationships
    SELECT parent_group_id, child_group_id
    FROM group_hierarchy
    
    UNION
    
    -- Recursive case: traverse up the hierarchy
    SELECT h.parent_group_id, t.child_group_id
    FROM group_hierarchy h
    JOIN group_tree t ON h.child_group_id = t.parent_group_id
)
SELECT DISTINCT g.id AS group_id, p.id AS permission_id, p.resource, p.action
FROM groups g
JOIN group_permissions gp ON g.id = gp.group_id
JOIN permissions p ON gp.permission_id = p.id

UNION

SELECT DISTINCT gt.child_group_id AS group_id, p.id AS permission_id, p.resource, p.action
FROM group_tree gt
JOIN group_permissions gp ON gt.parent_group_id = gp.group_id
JOIN permissions p ON gp.permission_id = p.id;

CREATE OR REPLACE VIEW user_effective_permissions AS
-- Direct user permissions (highest precedence)
SELECT u.id AS user_id, p.id AS permission_id, p.resource, p.action, 
       up.granted AS is_granted, 1 AS precedence
FROM users u
JOIN user_permissions up ON u.id = up.user_id
JOIN permissions p ON up.permission_id = p.id

UNION ALL

-- Permissions from user's roles
SELECT u.id AS user_id, erp.permission_id, erp.resource, erp.action, 
       TRUE AS is_granted, 2 AS precedence
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN effective_role_permissions erp ON ur.role_id = erp.role_id

UNION ALL

-- Permissions from user's groups
SELECT u.id AS user_id, egp.permission_id, egp.resource, egp.action, 
       TRUE AS is_granted, 3 AS precedence
FROM users u
JOIN user_groups ug ON u.id = ug.user_id
JOIN effective_group_permissions egp ON ug.group_id = egp.group_id

ORDER BY user_id, permission_id, precedence;

-- Step 12: Create function to check user permissions
CREATE OR REPLACE FUNCTION user_has_permission(
    user_id INT,
    resource_name VARCHAR,
    action_name VARCHAR
) RETURNS BOOLEAN AS $$
DECLARE
    has_perm BOOLEAN;
BEGIN
    -- First check if there's a direct user permission that denies access
    SELECT NOT is_granted INTO has_perm
    FROM user_effective_permissions
    WHERE user_id = $1 
      AND resource = $2 
      AND action = $3
      AND precedence = 1 
      AND NOT is_granted;
      
    IF FOUND AND NOT has_perm THEN
        RETURN FALSE;
    END IF;
    
    -- Then check if there's any permission that grants access
    SELECT EXISTS (
        SELECT 1
        FROM user_effective_permissions
        WHERE user_id = $1 
          AND resource = $2 
          AND action = $3
          AND is_granted
    ) INTO has_perm;
    
    RETURN COALESCE(has_perm, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Step 13: Insert default permissions
INSERT INTO permissions (name, resource, action, description)
VALUES 
-- User management permissions
('View Users', 'user', 'read', 'Can view user list and details'),
('Create Users', 'user', 'create', 'Can create new users'),
('Update Users', 'user', 'update', 'Can update user details'),
('Delete Users', 'user', 'delete', 'Can delete users'),

-- Role management permissions
('View Roles', 'role', 'read', 'Can view role list and details'),
('Create Roles', 'role', 'create', 'Can create new roles'),
('Update Roles', 'role', 'update', 'Can update role details'),
('Delete Roles', 'role', 'delete', 'Can delete roles'),
('Assign Roles', 'role', 'assign', 'Can assign roles to users'),

-- Group management permissions
('View Groups', 'group', 'read', 'Can view group list and details'),
('Create Groups', 'group', 'create', 'Can create new groups'),
('Update Groups', 'group', 'update', 'Can update group details'),
('Delete Groups', 'group', 'delete', 'Can delete groups'),
('Manage Group Members', 'group', 'manage_members', 'Can add/remove users from groups'),

-- Permission management
('Manage Permissions', 'permission', 'manage', 'Can assign permissions to roles and groups'),
('View Permissions', 'permission', 'read', 'Can view permissions'),

-- System administration
('System Configuration', 'system', 'configure', 'Can configure system settings'),
('View Audit Logs', 'audit', 'read', 'Can view audit logs'),
('Export Data', 'data', 'export', 'Can export data from the system'),
('Import Data', 'data', 'import', 'Can import data into the system')

ON CONFLICT (resource, action) DO NOTHING;

-- Step 14: Configure baseline role hierarchy
-- First, update existing roles with hierarchy levels
UPDATE roles SET level = 1, is_system = TRUE WHERE name = 'USER';
UPDATE roles SET level = 2, is_system = TRUE WHERE name = 'ADMIN';
UPDATE roles SET level = 3, is_system = TRUE WHERE name = 'SUPERUSER';
UPDATE roles SET level = 4, is_system = TRUE WHERE name = 'SUPERADMIN';
UPDATE roles SET level = 2, is_system = TRUE WHERE name = 'PROJECT_MANAGER';

-- Then establish hierarchy relationships
-- SUPERADMIN > SUPERUSER > ADMIN > USER
INSERT INTO role_hierarchy (parent_role_id, child_role_id)
SELECT p.id, c.id 
FROM roles p, roles c 
WHERE p.name = 'SUPERADMIN' AND c.name = 'SUPERUSER'
ON CONFLICT DO NOTHING;

INSERT INTO role_hierarchy (parent_role_id, child_role_id)
SELECT p.id, c.id 
FROM roles p, roles c 
WHERE p.name = 'SUPERUSER' AND c.name = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_hierarchy (parent_role_id, child_role_id)
SELECT p.id, c.id 
FROM roles p, roles c 
WHERE p.name = 'ADMIN' AND c.name = 'USER'
ON CONFLICT DO NOTHING;

-- PROJECT_MANAGER > USER
INSERT INTO role_hierarchy (parent_role_id, child_role_id)
SELECT p.id, c.id 
FROM roles p, roles c 
WHERE p.name = 'PROJECT_MANAGER' AND c.name = 'USER'
ON CONFLICT DO NOTHING;

-- Step 15: Create default groups
INSERT INTO groups (name, description)
VALUES 
('System Administrators', 'Users with full system administration access'),
('User Administrators', 'Users who can manage other users'),
('Content Managers', 'Users who manage content')
ON CONFLICT (name) DO NOTHING; 