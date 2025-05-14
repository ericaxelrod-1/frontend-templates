import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { Permission } from './modules/permissions/entities/permission.entity';

// Load environment variables
config();

/**
 * This script seeds default permissions into the permissions table
 */
async function seedPermissions() {
  console.log('Starting permission seeding...');

  const dataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DATABASE_PATH || './database/database.sqlite',
    synchronize: false,
    logging: true,
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    subscribers: [],
  });

  try {
    await dataSource.initialize();
    console.log('Data source has been initialized!');

    const permissionRepository = dataSource.getRepository(Permission);

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
      console.log(`Checking permission: ${permDef.resource}:${permDef.action}`);
      
      const permissionName = `${permDef.resource}:${permDef.action}`;
      
      // Use TypeORM repository to check for existing permission
      const existingPermission = await permissionRepository.findOne({
        where: {
          name: permissionName
        }
      });
      
      if (!existingPermission) {
        // Create new permission
        const newPermission = permissionRepository.create({
          name: permissionName,
          description: permDef.description,
          resourceName: permDef.resource,
          action: permDef.action,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        await permissionRepository.save(newPermission);
        console.log(`Created permission: ${permissionName}`);
      } else {
        console.log(`Permission already exists: ${permissionName}`);
      }
    }
    
    // Validate permissions were created
    const permissions = await permissionRepository.find();
    console.log(`Total permissions in database: ${permissions.length}`);
    
    // List all permissions
    console.log('\nPermissions in database:');
    for (const perm of permissions) {
      console.log(`- ${perm.name} (${perm.resourceName}:${perm.action})`);
    }

  } catch (error) {
    console.error('Error during permission seeding:', error);
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('Data source has been closed.');
    }
  }
}

// Run the seeding
seedPermissions().catch(error => console.error('Unhandled error:', error)); 