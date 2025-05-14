-- Role Permissions Schema Fix Script
-- Generated: 2025-05-09 10:57:54

BEGIN TRANSACTION;
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);
CREATE INDEX IF NOT EXISTS idx_permissions_resource_name ON permissions(resource_name);
CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions(action);

COMMIT;