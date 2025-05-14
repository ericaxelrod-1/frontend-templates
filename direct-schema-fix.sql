-- Fix permissions table
BEGIN TRANSACTION;

-- Check if users table exists, if not create it
CREATE TABLE IF NOT EXISTS "users" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "username" VARCHAR(255) UNIQUE NOT NULL,
  "password" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255) UNIQUE NOT NULL,
  "is_active" BOOLEAN DEFAULT 1 NOT NULL,
  "is_email_verified" BOOLEAN DEFAULT 0 NOT NULL,
  "last_login" DATETIME,
  "first_name" VARCHAR(255),
  "last_name" VARCHAR(255),
  "preferences" TEXT, -- For simple-json
  "email_verified" BOOLEAN DEFAULT 0 NOT NULL,
  "registration_verification_sent" BOOLEAN DEFAULT 0 NOT NULL,
  "user_verified" BOOLEAN DEFAULT 0 NOT NULL,
  "user_deleted" BOOLEAN DEFAULT 0 NOT NULL,
  "delete_date" DATETIME,
  "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Check if permissions table exists, if not create it
CREATE TABLE IF NOT EXISTS "permissions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" VARCHAR(100) UNIQUE,
  "description" TEXT,
  "resource_name" VARCHAR(50),
  "action" VARCHAR(50),
  "action_id" INTEGER,
  "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes on permissions table
CREATE INDEX IF NOT EXISTS "idx_permissions_name" ON "permissions" ("name");
CREATE INDEX IF NOT EXISTS "idx_permissions_resource_name" ON "permissions" ("resource_name");
CREATE INDEX IF NOT EXISTS "idx_permissions_action" ON "permissions" ("action");

-- Check if roles table exists, if not create it
CREATE TABLE IF NOT EXISTS "roles" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" VARCHAR(100) UNIQUE NOT NULL,
  "description" TEXT,
  "is_system_role" BOOLEAN DEFAULT 0,
  "is_default" BOOLEAN DEFAULT 0,
  "parent_id" INTEGER,
  "priority" INTEGER DEFAULT 0,
  "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes on roles table
CREATE INDEX IF NOT EXISTS "idx_roles_name" ON "roles" ("name");
CREATE INDEX IF NOT EXISTS "idx_roles_is_default" ON "roles" ("is_default");

-- Insert default roles if they don't exist
INSERT OR IGNORE INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
VALUES ('admin', 'Administrator with full system access', 1, 0, 100);

INSERT OR IGNORE INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
VALUES ('user', 'Default user role', 1, 1, 10);

-- Check if role_permissions table exists, if not create it
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "role_id" INTEGER NOT NULL,
  "permission_id" INTEGER NOT NULL,
  "granted" BOOLEAN DEFAULT 1,
  "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("role_id", "permission_id")
);

-- Create indexes on role_permissions table
CREATE INDEX IF NOT EXISTS "idx_role_permissions_role_id" ON "role_permissions" ("role_id");
CREATE INDEX IF NOT EXISTS "idx_role_permissions_permission_id" ON "role_permissions" ("permission_id");

-- Insert default permissions
-- Roles permissions
INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action", "created_at", "updated_at")
VALUES 
  ('roles:read', 'Permission to read roles', 'roles', 'read', datetime('now'), datetime('now')),
  ('roles:create', 'Permission to create roles', 'roles', 'create', datetime('now'), datetime('now')),
  ('roles:update', 'Permission to update roles', 'roles', 'update', datetime('now'), datetime('now')),
  ('roles:delete', 'Permission to delete roles', 'roles', 'delete', datetime('now'), datetime('now')),
  ('roles:admin', 'Permission to administer roles', 'roles', 'admin', datetime('now'), datetime('now'));

-- Users permissions
INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action", "created_at", "updated_at")
VALUES 
  ('users:read', 'Permission to read users', 'users', 'read', datetime('now'), datetime('now')),
  ('users:create', 'Permission to create users', 'users', 'create', datetime('now'), datetime('now')),
  ('users:update', 'Permission to update users', 'users', 'update', datetime('now'), datetime('now')),
  ('users:delete', 'Permission to delete users', 'users', 'delete', datetime('now'), datetime('now')),
  ('users:admin', 'Permission to administer users', 'users', 'admin', datetime('now'), datetime('now'));

-- Groups permissions
INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action", "created_at", "updated_at")
VALUES 
  ('groups:read', 'Permission to read groups', 'groups', 'read', datetime('now'), datetime('now')),
  ('groups:create', 'Permission to create groups', 'groups', 'create', datetime('now'), datetime('now')),
  ('groups:update', 'Permission to update groups', 'groups', 'update', datetime('now'), datetime('now')),
  ('groups:delete', 'Permission to delete groups', 'groups', 'delete', datetime('now'), datetime('now')),
  ('groups:admin', 'Permission to administer groups', 'groups', 'admin', datetime('now'), datetime('now'));

-- Permissions permissions (meta)
INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action", "created_at", "updated_at")
VALUES 
  ('permissions:read', 'Permission to read permissions', 'permissions', 'read', datetime('now'), datetime('now')),
  ('permissions:create', 'Permission to create permissions', 'permissions', 'create', datetime('now'), datetime('now')),
  ('permissions:update', 'Permission to update permissions', 'permissions', 'update', datetime('now'), datetime('now')),
  ('permissions:delete', 'Permission to delete permissions', 'permissions', 'delete', datetime('now'), datetime('now')),
  ('permissions:admin', 'Permission to administer permissions', 'permissions', 'admin', datetime('now'), datetime('now'));

-- System permissions
INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action", "created_at", "updated_at")
VALUES 
  ('system:read', 'Permission to read system information', 'system', 'read', datetime('now'), datetime('now')),
  ('system:update', 'Permission to update system settings', 'system', 'update', datetime('now'), datetime('now')),
  ('system:admin', 'Permission to administer system', 'system', 'admin', datetime('now'), datetime('now'));

-- Ensure resource_name and action are set correctly
UPDATE "permissions"
SET "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1)
WHERE "resource_name" IS NULL AND INSTR("name", ':') > 0;

UPDATE "permissions"
SET "action" = SUBSTR("name", INSTR("name", ':') + 1)
WHERE "action" IS NULL AND INSTR("name", ':') > 0;

-- Now assign all permissions to admin role
-- First get admin role ID
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, 1
FROM roles r, permissions p
WHERE r.name = 'admin';

COMMIT; 