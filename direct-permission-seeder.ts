import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load environment variables
config();

/**
 * This script directly seeds permissions into the permissions table
 * It doesn't rely on the Nest.js module system, making it more reliable
 * for fixing schema issues
 */
async function seedPermissions() {
  console.log('Starting direct permission seeding...');

  const dataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DATABASE_PATH || './database.sqlite',
    synchronize: false,
    logging: true,
  });

  try {
    await dataSource.initialize();
    console.log('Data source has been initialized!');

    const queryRunner = dataSource.createQueryRunner();
    
    // First ensure the permissions table exists
    const permissionsTableExists = await queryRunner.hasTable('permissions');
    if (!permissionsTableExists) {
      console.log('Error: permissions table does not exist');
      return;
    }
    
    console.log('Checking columns in permissions table...');
    const columns = await queryRunner.query("PRAGMA table_info(permissions)");
    const columnNames = columns.map((col: any) => col.name);
    console.log(`Permissions table columns: ${columnNames.join(', ')}`);
    
    // Default permissions - each represents a resource:action pair
    const defaultPermissions = [
      // Roles permissions
      { resource: 'roles', action: 'read', description: 'Permission to read roles' },
      { resource: 'roles', action: 'create', description: 'Permission to create roles' },
      { resource: 'roles', action: 'update', description: 'Permission to update roles' },
      { resource: 'roles', action: 'delete', description: 'Permission to delete roles' },
      { resource: 'roles', action: 'admin', description: 'Permission to administer roles' },
      
      // Users permissions
      { resource: 'users', action: 'read', description: 'Permission to read users' },
      { resource: 'users', action: 'create', description: 'Permission to create users' },
      { resource: 'users', action: 'update', description: 'Permission to update users' },
      { resource: 'users', action: 'delete', description: 'Permission to delete users' },
      { resource: 'users', action: 'admin', description: 'Permission to administer users' },
      
      // Groups permissions
      { resource: 'groups', action: 'read', description: 'Permission to read groups' },
      { resource: 'groups', action: 'create', description: 'Permission to create groups' },
      { resource: 'groups', action: 'update', description: 'Permission to update groups' },
      { resource: 'groups', action: 'delete', description: 'Permission to delete groups' },
      { resource: 'groups', action: 'admin', description: 'Permission to administer groups' },
      
      // Permissions permissions (meta!)
      { resource: 'permissions', action: 'read', description: 'Permission to read permissions' },
      { resource: 'permissions', action: 'create', description: 'Permission to create permissions' },
      { resource: 'permissions', action: 'update', description: 'Permission to update permissions' },
      { resource: 'permissions', action: 'delete', description: 'Permission to delete permissions' },
      { resource: 'permissions', action: 'admin', description: 'Permission to administer permissions' },
      
      // System permissions
      { resource: 'system', action: 'read', description: 'Permission to read system information' },
      { resource: 'system', action: 'update', description: 'Permission to update system settings' },
      { resource: 'system', action: 'admin', description: 'Permission to administer system' },
    ];
    
    console.log(`Creating ${defaultPermissions.length} default permissions...`);
    
    // Create each permission if it doesn't exist
    for (const permDef of defaultPermissions) {
      console.log(`Processing permission: ${permDef.resource}:${permDef.action}`);
      const permissionName = `${permDef.resource}:${permDef.action}`;
      
      // Check if permission already exists
      const existingPerm = await queryRunner.query(
        `SELECT * FROM permissions WHERE name = ? LIMIT 1`, 
        [permissionName]
      );
      
      if (existingPerm.length === 0) {
        // Create new permission
        await queryRunner.query(
          `INSERT INTO permissions (name, description, resource_name, action, created_at, updated_at) 
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [permissionName, permDef.description, permDef.resource, permDef.action]
        );
        
        console.log(`Created permission: ${permissionName}`);
      } else {
        // Update existing permission to ensure resource_name and action are set
        await queryRunner.query(
          `UPDATE permissions 
           SET resource_name = ?, action = ? 
           WHERE name = ?`,
          [permDef.resource, permDef.action, permissionName]
        );
        
        console.log(`Updated permission: ${permissionName}`);
      }
    }
    
    // Validate permissions were created
    const permissions = await queryRunner.query(`SELECT * FROM permissions`);
    console.log(`Total permissions in database: ${permissions.length}`);
    
    // Assign permissions to admin role if possible
    const rolesTableExists = await queryRunner.hasTable('roles');
    const rolePermissionsTableExists = await queryRunner.hasTable('role_permissions');
    
    if (rolesTableExists && rolePermissionsTableExists) {
      console.log('Checking for admin role to assign permissions...');
      
      const adminRoles = await queryRunner.query(
        `SELECT * FROM roles WHERE name LIKE '%admin%'`
      );
      
      if (adminRoles.length > 0) {
        console.log(`Found ${adminRoles.length} admin roles, assigning all permissions...`);
        
        for (const role of adminRoles) {
          console.log(`Assigning permissions to role: ${role.name} (id: ${role.id})`);
          
          for (const permission of permissions) {
            // Check if the role already has this permission
            const existingRolePerm = await queryRunner.query(
              `SELECT * FROM role_permissions 
               WHERE role_id = ? AND permission_id = ? LIMIT 1`,
              [role.id, permission.id]
            );
            
            if (existingRolePerm.length === 0) {
              // Create new role permission
              await queryRunner.query(
                `INSERT INTO role_permissions 
                (role_id, permission_id, granted, created_at, updated_at)
                VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
                [role.id, permission.id]
              );
              
              console.log(`Assigned permission ${permission.name} to role ${role.name}`);
            }
          }
        }
      } else {
        console.log('No admin roles found - skipping role permission assignment');
      }
    } else {
      console.log('Roles or role_permissions table missing - skipping role permission assignment');
    }
    
    console.log('Permission seeding completed successfully!');

  } catch (error) {
    console.error('Error during permission seeding:', error);
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('Data source has been closed.');
    }
  }
}

// Run the seeding function
seedPermissions().catch(error => console.error('Unhandled error:', error)); 