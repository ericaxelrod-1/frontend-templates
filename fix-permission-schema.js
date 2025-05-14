const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database path
const dbPath = path.join(__dirname, 'db.sqlite');
console.log(`Opening database at ${dbPath}`);

// Connect to the database
const db = new sqlite3.Database(dbPath);

// Execute the fix with individual statements
db.serialize(() => {
  console.log('Starting schema fix...');
  
  // Begin transaction
  db.run('BEGIN TRANSACTION');
  
  // Create or modify the permissions table
  console.log('Fixing permissions table...');
  
  // Create permissions table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS "permissions" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" VARCHAR(100) UNIQUE,
      "description" TEXT,
      "resource_name" VARCHAR(50),
      "action" VARCHAR(50),
      "action_id" INTEGER,
      "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS "idx_permissions_name" ON "permissions" ("name")`);
  db.run(`CREATE INDEX IF NOT EXISTS "idx_permissions_resource_name" ON "permissions" ("resource_name")`);
  db.run(`CREATE INDEX IF NOT EXISTS "idx_permissions_action" ON "permissions" ("action")`);
  
  // Create roles table if it doesn't exist
  console.log('Fixing roles table...');
  db.run(`
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
    )
  `);
  
  // Create indexes for roles
  db.run(`CREATE INDEX IF NOT EXISTS "idx_roles_name" ON "roles" ("name")`);
  db.run(`CREATE INDEX IF NOT EXISTS "idx_roles_is_default" ON "roles" ("is_default")`);
  
  // Insert default roles if they don't exist
  db.run(`
    INSERT OR IGNORE INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
    VALUES ('admin', 'Administrator with full system access', 1, 0, 100)
  `);
  
  db.run(`
    INSERT OR IGNORE INTO "roles" ("name", "description", "is_system_role", "is_default", "priority")
    VALUES ('user', 'Default user role', 1, 1, 10)
  `);
  
  // Create role_permissions table if it doesn't exist
  console.log('Fixing role_permissions table...');
  db.run(`
    CREATE TABLE IF NOT EXISTS "role_permissions" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "role_id" INTEGER NOT NULL,
      "permission_id" INTEGER NOT NULL,
      "granted" BOOLEAN DEFAULT 1,
      "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("role_id", "permission_id")
    )
  `);
  
  // Create indexes for role_permissions
  db.run(`CREATE INDEX IF NOT EXISTS "idx_role_permissions_role_id" ON "role_permissions" ("role_id")`);
  db.run(`CREATE INDEX IF NOT EXISTS "idx_role_permissions_permission_id" ON "role_permissions" ("permission_id")`);
  
  // Insert default permissions
  console.log('Adding default permissions...');
  
  // Roles permissions
  db.run(`
    INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action")
    VALUES 
      ('roles:read', 'Permission to read roles', 'roles', 'read'),
      ('roles:create', 'Permission to create roles', 'roles', 'create'),
      ('roles:update', 'Permission to update roles', 'roles', 'update'),
      ('roles:delete', 'Permission to delete roles', 'roles', 'delete'),
      ('roles:admin', 'Permission to administer roles', 'roles', 'admin')
  `);
  
  // Users permissions
  db.run(`
    INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action")
    VALUES 
      ('users:read', 'Permission to read users', 'users', 'read'),
      ('users:create', 'Permission to create users', 'users', 'create'),
      ('users:update', 'Permission to update users', 'users', 'update'),
      ('users:delete', 'Permission to delete users', 'users', 'delete'),
      ('users:admin', 'Permission to administer users', 'users', 'admin')
  `);
  
  // Groups permissions
  db.run(`
    INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action")
    VALUES 
      ('groups:read', 'Permission to read groups', 'groups', 'read'),
      ('groups:create', 'Permission to create groups', 'groups', 'create'),
      ('groups:update', 'Permission to update groups', 'groups', 'update'),
      ('groups:delete', 'Permission to delete groups', 'groups', 'delete'),
      ('groups:admin', 'Permission to administer groups', 'groups', 'admin')
  `);
  
  // Permissions permissions
  db.run(`
    INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action")
    VALUES 
      ('permissions:read', 'Permission to read permissions', 'permissions', 'read'),
      ('permissions:create', 'Permission to create permissions', 'permissions', 'create'),
      ('permissions:update', 'Permission to update permissions', 'permissions', 'update'),
      ('permissions:delete', 'Permission to delete permissions', 'permissions', 'delete'),
      ('permissions:admin', 'Permission to administer permissions', 'permissions', 'admin')
  `);
  
  // System permissions
  db.run(`
    INSERT OR IGNORE INTO "permissions" ("name", "description", "resource_name", "action")
    VALUES 
      ('system:read', 'Permission to read system information', 'system', 'read'),
      ('system:update', 'Permission to update system settings', 'system', 'update'),
      ('system:admin', 'Permission to administer system', 'system', 'admin')
  `);
  
  // Ensure resource_name and action are set correctly based on name
  db.run(`
    UPDATE "permissions"
    SET "resource_name" = SUBSTR("name", 1, INSTR("name", ':') - 1)
    WHERE "resource_name" IS NULL AND INSTR("name", ':') > 0
  `);
  
  db.run(`
    UPDATE "permissions"
    SET "action" = SUBSTR("name", INSTR("name", ':') + 1)
    WHERE "action" IS NULL AND INSTR("name", ':') > 0
  `);
  
  // Assign permissions to admin role
  console.log('Assigning permissions to admin role...');
  db.run(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted)
    SELECT r.id, p.id, 1
    FROM roles r, permissions p
    WHERE r.name = 'admin'
  `);
  
  // Commit transaction
  db.run('COMMIT');
  
  console.log('Schema fix completed!');
  
  // Verify changes
  console.log('Verifying changes...');
  
  db.get('SELECT COUNT(*) as count FROM permissions', (err, row) => {
    if (err) {
      console.error('Error counting permissions:', err);
    } else {
      console.log(`Number of permissions: ${row.count}`);
    }
    
    db.get('SELECT COUNT(*) as count FROM roles', (err, row) => {
      if (err) {
        console.error('Error counting roles:', err);
      } else {
        console.log(`Number of roles: ${row.count}`);
      }
      
      db.get('SELECT COUNT(*) as count FROM role_permissions', (err, row) => {
        if (err) {
          console.error('Error counting role permissions:', err);
        } else {
          console.log(`Number of role-permission relationships: ${row.count}`);
        }
        
        db.all('SELECT * FROM permissions LIMIT 5', (err, rows) => {
          if (err) {
            console.error('Error getting sample permissions:', err);
          } else {
            console.log('\nSample permissions:');
            rows.forEach(row => {
              console.log(`- ${row.name} (${row.resource_name}:${row.action})`);
            });
          }
          
          // Close the database
          db.close((err) => {
            if (err) {
              console.error('Error closing database:', err);
            } else {
              console.log('Database connection closed.');
            }
          });
        });
      });
    });
  });
}); 