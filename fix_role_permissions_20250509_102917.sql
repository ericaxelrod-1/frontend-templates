-- Role Permissions Schema Fix Script
-- Generated: 2025-05-09 10:29:18

BEGIN TRANSACTION;

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  resource_name VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  action_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO permissions SELECT * FROM permission;


-- Drop existing role_permissions table
DROP TABLE IF EXISTS role_permissions_temp;

-- Create a new role_permissions table with updated foreign key
CREATE TABLE role_permissions_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

-- Copy data from original table
INSERT INTO role_permissions_temp
SELECT * FROM role_permissions;

-- Drop original table
DROP TABLE role_permissions;

-- Rename temp table to original name
ALTER TABLE role_permissions_temp RENAME TO role_permissions;

-- Recreate indexes
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);



-- Drop existing user_permission table
DROP TABLE IF EXISTS user_permission_temp;

-- Create a new user_permission table with updated foreign key
CREATE TABLE user_permission_temp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (user_id, permission_id)
);

-- Copy data from original table
INSERT INTO user_permission_temp
SELECT * FROM user_permission;

-- Drop original table
DROP TABLE user_permission;

-- Rename temp table to original name
ALTER TABLE user_permission_temp RENAME TO user_permission;

-- Recreate indexes
CREATE INDEX idx_user_permission_user_id ON user_permission(user_id);
CREATE INDEX idx_user_permission_permission_id ON user_permission(permission_id);


COMMIT;
