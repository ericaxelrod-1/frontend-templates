-- Role Permissions Schema Fix Script
-- Generated: 2025-05-09 11:03:09

BEGIN TRANSACTION;
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);
CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions(resource_name);
CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions(action);

COMMIT;