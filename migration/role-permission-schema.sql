-- Database Schema Migration for Dynamic Role-Based Access Control
-- Compatible with PostgreSQL and MySQL
-- This script adds hierarchical roles, permissions, and relationships

-- ====================================================================
-- Role Schema Changes: Add parent_id for hierarchical roles
-- ====================================================================

-- Add parent_id to role table to support hierarchical roles
ALTER TABLE role 
ADD COLUMN parent_id INT NULL;

-- Add foreign key constraint to enforce parent-child relationship
ALTER TABLE role
ADD CONSTRAINT fk_role_parent
FOREIGN KEY (parent_id) REFERENCES role(id)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Add index for parent_id for performance
CREATE INDEX idx_role_parent_id ON role(parent_id);

-- ====================================================================
-- Permissions Tables
-- ====================================================================

-- Create resources table to store trackable resources in the system
CREATE TABLE resource (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (name)
);

-- Create actions table to define possible actions on resources
CREATE TABLE action (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (name)
);

-- Insert common actions
INSERT INTO action (name, description) VALUES
('create', 'Create a new resource'),
('read', 'View a resource'),
('update', 'Modify an existing resource'),
('delete', 'Remove a resource'),
('list', 'View a list of resources'),
('manage', 'Full control over a resource');

-- Create permissions table (resource-action pairs)
CREATE TABLE permission (
    id INT PRIMARY KEY AUTO_INCREMENT,
    resource_id INT NOT NULL,
    action_id INT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resource(id) ON DELETE CASCADE,
    FOREIGN KEY (action_id) REFERENCES action(id) ON DELETE CASCADE,
    UNIQUE (resource_id, action_id)
);

-- ====================================================================
-- Role-Permission Relationships
-- ====================================================================

-- Link roles and permissions
CREATE TABLE role_permission (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES role(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE CASCADE
);

-- ====================================================================
-- Group Structure Changes
-- ====================================================================

-- Add parent_id to group table to support hierarchical groups
ALTER TABLE "group" 
ADD COLUMN parent_id INT NULL;

-- Add foreign key constraint for hierarchical groups
ALTER TABLE "group"
ADD CONSTRAINT fk_group_parent
FOREIGN KEY (parent_id) REFERENCES "group"(id)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Add index for parent_id for performance
CREATE INDEX idx_group_parent_id ON "group"(parent_id);

-- ====================================================================
-- Group-Permission Relationships
-- ====================================================================

-- Link groups and permissions
CREATE TABLE group_permission (
    group_id INT NOT NULL,
    permission_id INT NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, permission_id),
    FOREIGN KEY (group_id) REFERENCES "group"(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE CASCADE
);

-- ====================================================================
-- User-Permission Relationships (for overrides)
-- ====================================================================

-- Link users and permissions directly (for overrides)
CREATE TABLE user_permission (
    user_id INT NOT NULL,
    permission_id INT NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT TRUE, -- TRUE to grant, FALSE to deny even if allowed by role/group
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, permission_id),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE CASCADE
);

-- ====================================================================
-- Indexes for performance
-- ====================================================================

CREATE INDEX idx_permission_resource_action ON permission(resource_id, action_id);
CREATE INDEX idx_role_permission_role ON role_permission(role_id);
CREATE INDEX idx_role_permission_permission ON role_permission(permission_id);
CREATE INDEX idx_group_permission_group ON group_permission(group_id);
CREATE INDEX idx_group_permission_permission ON group_permission(permission_id);
CREATE INDEX idx_user_permission_user ON user_permission(user_id);
CREATE INDEX idx_user_permission_permission ON user_permission(permission_id);

-- ====================================================================
-- Generic view for effective permissions
-- ====================================================================

-- This view shows effective permissions for each user
-- Priority: User permissions override group permissions override role permissions
CREATE OR REPLACE VIEW effective_user_permissions AS
WITH all_permissions AS (
    -- Role permissions
    SELECT 
        u.id AS user_id,
        p.id AS permission_id,
        r.name AS source_role,
        NULL AS source_group,
        'role' AS source_type,
        rp.granted,
        r.id AS role_id,
        NULL AS group_id,
        1 AS priority  -- Role permissions have lowest priority
    FROM 
        user u
        JOIN role r ON u.role_id = r.id
        JOIN role_permission rp ON r.id = rp.role_id
        JOIN permission p ON rp.permission_id = p.id
    
    UNION ALL
    
    -- Inherited role permissions (from parent roles)
    SELECT 
        u.id AS user_id,
        p.id AS permission_id,
        parent.name AS source_role,
        NULL AS source_group,
        'parent_role' AS source_type,
        rp.granted,
        parent.id AS role_id,
        NULL AS group_id,
        1 AS priority  -- Role permissions have lowest priority
    FROM 
        user u
        JOIN role r ON u.role_id = r.id
        JOIN role parent ON r.parent_id = parent.id
        JOIN role_permission rp ON parent.id = rp.role_id
        JOIN permission p ON rp.permission_id = p.id
    
    UNION ALL
    
    -- Group permissions
    SELECT 
        u.id AS user_id,
        p.id AS permission_id,
        NULL AS source_role,
        g.name AS source_group,
        'group' AS source_type,
        gp.granted,
        NULL AS role_id,
        g.id AS group_id,
        2 AS priority  -- Group permissions have medium priority
    FROM 
        user u
        JOIN user_group ug ON u.id = ug.user_id
        JOIN "group" g ON ug.group_id = g.id
        JOIN group_permission gp ON g.id = gp.group_id
        JOIN permission p ON gp.permission_id = p.id
    
    UNION ALL
    
    -- Inherited group permissions (from parent groups)
    SELECT 
        u.id AS user_id,
        p.id AS permission_id,
        NULL AS source_role,
        parent.name AS source_group,
        'parent_group' AS source_type,
        gp.granted,
        NULL AS role_id,
        parent.id AS group_id,
        2 AS priority  -- Group permissions have medium priority
    FROM 
        user u
        JOIN user_group ug ON u.id = ug.user_id
        JOIN "group" g ON ug.group_id = g.id
        JOIN "group" parent ON g.parent_id = parent.id
        JOIN group_permission gp ON parent.id = gp.group_id
        JOIN permission p ON gp.permission_id = p.id
    
    UNION ALL
    
    -- User-specific permissions (overrides)
    SELECT 
        u.id AS user_id,
        p.id AS permission_id,
        NULL AS source_role,
        NULL AS source_group,
        'user' AS source_type,
        up.granted,
        NULL AS role_id,
        NULL AS group_id,
        3 AS priority  -- User permissions have highest priority
    FROM 
        user u
        JOIN user_permission up ON u.id = up.user_id
        JOIN permission p ON up.permission_id = p.id
)
SELECT 
    user_id,
    permission_id,
    source_type,
    source_role,
    source_group,
    granted
FROM (
    SELECT 
        user_id,
        permission_id,
        source_type,
        source_role,
        source_group,
        granted,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, permission_id 
            ORDER BY priority DESC
        ) AS rn
    FROM 
        all_permissions
) ranked
WHERE 
    rn = 1;

-- ====================================================================
-- Compatibility fixes for different database systems
-- ====================================================================

-- PostgreSQL uses double quotes for identifiers, MySQL uses backticks
-- The script above uses double quotes for "group" which is a reserved keyword

-- For PostgreSQL-specific syntax
DO $$
BEGIN
    -- Check if we're in PostgreSQL
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'pg_class'
    ) THEN
        -- These commands are PostgreSQL specific
        -- Fix the quotes for group table
        EXECUTE 'ALTER TABLE "group" ADD COLUMN parent_id INT NULL';
        EXECUTE 'ALTER TABLE "group" ADD CONSTRAINT fk_group_parent
                 FOREIGN KEY (parent_id) REFERENCES "group"(id)
                 ON DELETE SET NULL ON UPDATE CASCADE';
        EXECUTE 'CREATE INDEX idx_group_parent_id ON "group"(parent_id)';
        
        -- Use PostgreSQL syntax for the view
        EXECUTE '
        CREATE OR REPLACE VIEW effective_user_permissions AS
        WITH all_permissions AS (
            -- Role permissions
            SELECT 
                u.id AS user_id,
                p.id AS permission_id,
                r.name AS source_role,
                NULL AS source_group,
                ''role'' AS source_type,
                rp.granted,
                r.id AS role_id,
                NULL AS group_id,
                1 AS priority
            FROM 
                "user" u
                JOIN role r ON u.role_id = r.id
                JOIN role_permission rp ON r.id = rp.role_id
                JOIN permission p ON rp.permission_id = p.id
            
            UNION ALL
            
            -- Inherited role permissions
            SELECT 
                u.id AS user_id,
                p.id AS permission_id,
                parent.name AS source_role,
                NULL AS source_group,
                ''parent_role'' AS source_type,
                rp.granted,
                parent.id AS role_id,
                NULL AS group_id,
                1 AS priority
            FROM 
                "user" u
                JOIN role r ON u.role_id = r.id
                JOIN role parent ON r.parent_id = parent.id
                JOIN role_permission rp ON parent.id = rp.role_id
                JOIN permission p ON rp.permission_id = p.id
            
            UNION ALL
            
            -- Group permissions
            SELECT 
                u.id AS user_id,
                p.id AS permission_id,
                NULL AS source_role,
                g.name AS source_group,
                ''group'' AS source_type,
                gp.granted,
                NULL AS role_id,
                g.id AS group_id,
                2 AS priority
            FROM 
                "user" u
                JOIN user_group ug ON u.id = ug.user_id
                JOIN "group" g ON ug.group_id = g.id
                JOIN group_permission gp ON g.id = gp.group_id
                JOIN permission p ON gp.permission_id = p.id
            
            UNION ALL
            
            -- Inherited group permissions
            SELECT 
                u.id AS user_id,
                p.id AS permission_id,
                NULL AS source_role,
                parent.name AS source_group,
                ''parent_group'' AS source_type,
                gp.granted,
                NULL AS role_id,
                parent.id AS group_id,
                2 AS priority
            FROM 
                "user" u
                JOIN user_group ug ON u.id = ug.user_id
                JOIN "group" g ON ug.group_id = g.id
                JOIN "group" parent ON g.parent_id = parent.id
                JOIN group_permission gp ON parent.id = gp.group_id
                JOIN permission p ON gp.permission_id = p.id
            
            UNION ALL
            
            -- User-specific permissions
            SELECT 
                u.id AS user_id,
                p.id AS permission_id,
                NULL AS source_role,
                NULL AS source_group,
                ''user'' AS source_type,
                up.granted,
                NULL AS role_id,
                NULL AS group_id,
                3 AS priority
            FROM 
                "user" u
                JOIN user_permission up ON u.id = up.user_id
                JOIN permission p ON up.permission_id = p.id
        )
        SELECT 
            user_id,
            permission_id,
            source_type,
            source_role,
            source_group,
            granted
        FROM (
            SELECT 
                user_id,
                permission_id,
                source_type,
                source_role,
                source_group,
                granted,
                ROW_NUMBER() OVER (
                    PARTITION BY user_id, permission_id 
                    ORDER BY priority DESC
                ) AS rn
            FROM 
                all_permissions
        ) ranked
        WHERE 
            rn = 1;
        ';
    END IF;
END $$;

-- For MySQL-specific syntax
-- MySQL uses backticks instead of double quotes and has different syntax for some operations
DELIMITER //
CREATE PROCEDURE apply_mysql_syntax()
BEGIN
    -- Check if we're in MySQL
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'information_schema' AND table_name = 'ENGINES') THEN
        -- MySQL-specific ALTER TABLE for the 'group' table (reserved keyword)
        ALTER TABLE `group` ADD COLUMN parent_id INT NULL;
        
        ALTER TABLE `group`
        ADD CONSTRAINT fk_group_parent
        FOREIGN KEY (parent_id) REFERENCES `group`(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE;
        
        CREATE INDEX idx_group_parent_id ON `group`(parent_id);
        
        -- MySQL timestamp behavior is different - may need manual adjustment
        -- Some MySQL versions don't support WITH clause or window functions
        -- Consider using a simpler view or a stored procedure for permission resolution
        DROP VIEW IF EXISTS effective_user_permissions;
        
        CREATE VIEW effective_user_permissions AS
        SELECT 
            up.user_id,
            up.permission_id,
            'user' AS source_type,
            NULL AS source_role,
            NULL AS source_group,
            up.granted
        FROM 
            user_permission up
        
        UNION ALL
        
        SELECT 
            u.id AS user_id,
            rp.permission_id,
            'role' AS source_type,
            r.name AS source_role,
            NULL AS source_group,
            rp.granted
        FROM 
            `user` u
            JOIN role r ON u.role_id = r.id
            JOIN role_permission rp ON r.id = rp.role_id
            LEFT JOIN user_permission up ON u.id = up.user_id AND rp.permission_id = up.permission_id
        WHERE 
            up.permission_id IS NULL
            
        UNION ALL
        
        SELECT 
            u.id AS user_id,
            gp.permission_id,
            'group' AS source_type,
            NULL AS source_role,
            g.name AS source_group,
            gp.granted
        FROM 
            `user` u
            JOIN user_group ug ON u.id = ug.user_id
            JOIN `group` g ON ug.group_id = g.id
            JOIN group_permission gp ON g.id = gp.group_id
            LEFT JOIN user_permission up ON u.id = up.user_id AND gp.permission_id = up.permission_id
            LEFT JOIN role_permission rp ON u.role_id = rp.role_id AND gp.permission_id = rp.permission_id
        WHERE 
            up.permission_id IS NULL
            AND rp.permission_id IS NULL;
    END IF;
END //
DELIMITER ;

CALL apply_mysql_syntax();
DROP PROCEDURE IF EXISTS apply_mysql_syntax; 