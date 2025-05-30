import { MigrationInterface, QueryRunner } from 'typeorm';

// First create actions that will be referenced by permissions
const actionSeedData = [
  { name: 'View', actionCode: 'view', description: 'View resource', category: 'read' },
  { name: 'Create', actionCode: 'create', description: 'Create new resource', category: 'write' },
  { name: 'Edit', actionCode: 'edit', description: 'Edit existing resource', category: 'write' },
  { name: 'Delete', actionCode: 'delete', description: 'Delete resource', category: 'write' },
  { name: 'Refresh', actionCode: 'refresh', description: 'Refresh resource', category: 'action' },
  { name: 'Test', actionCode: 'test', description: 'Test resource', category: 'action' },
];

const permissionSeedData = [
  // User management permissions
  {
    resourceName: 'users',
    actionCode: 'view',
    name: 'users:view',
    description: 'View users',
  },
  {
    resourceName: 'users',
    actionCode: 'create',
    name: 'users:create',
    description: 'Create users',
  },
  {
    resourceName: 'users',
    actionCode: 'edit',
    name: 'users:edit',
    description: 'Edit users',
  },
  {
    resourceName: 'users',
    actionCode: 'delete',
    name: 'users:delete',
    description: 'Delete users',
  },

  // Role management permissions
  {
    resourceName: 'roles',
    actionCode: 'view',
    name: 'roles:view',
    description: 'View roles',
  },
  {
    resourceName: 'roles',
    actionCode: 'create',
    name: 'roles:create',
    description: 'Create roles',
  },
  {
    resourceName: 'roles',
    actionCode: 'edit',
    name: 'roles:edit',
    description: 'Edit roles',
  },
  {
    resourceName: 'roles',
    actionCode: 'delete',
    name: 'roles:delete',
    description: 'Delete roles',
  },

  // Group management permissions
  {
    resourceName: 'groups',
    actionCode: 'view',
    name: 'groups:view',
    description: 'View groups',
  },
  {
    resourceName: 'groups',
    actionCode: 'create',
    name: 'groups:create',
    description: 'Create groups',
  },
  {
    resourceName: 'groups',
    actionCode: 'edit',
    name: 'groups:edit',
    description: 'Edit groups',
  },
  {
    resourceName: 'groups',
    actionCode: 'delete',
    name: 'groups:delete',
    description: 'Delete groups',
  },

  // Permission management permissions
  {
    resourceName: 'permissions',
    actionCode: 'view',
    name: 'permissions:view',
    description: 'View permissions',
  },
  {
    resourceName: 'permissions',
    actionCode: 'edit',
    name: 'permissions:edit',
    description: 'Edit permissions',
  },
  {
    resourceName: 'permissions',
    actionCode: 'refresh',
    name: 'permissions:refresh',
    description: 'Refresh permissions cache',
  },
  {
    resourceName: 'permissions',
    actionCode: 'test',
    name: 'permissions:test',
    description: 'Test permissions',
  },

  // Settings permissions
  {
    resourceName: 'settings',
    actionCode: 'view',
    name: 'settings:view',
    description: 'View system settings',
  },
  {
    resourceName: 'settings',
    actionCode: 'edit',
    name: 'settings:edit',
    description: 'Edit system settings',
  },

  // Dashboard permissions
  {
    resourceName: 'dashboard',
    actionCode: 'view',
    name: 'dashboard:view',
    description: 'View dashboard',
  },
  {
    resourceName: 'dashboard',
    actionCode: 'edit',
    name: 'dashboard:edit',
    description: 'Edit dashboard',
  },
];

export class SeedPermissionsData1690000000001 implements MigrationInterface {
  name = 'SeedPermissionsData1690000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create actions first (required for permissions)
    const actionMap = new Map<string, number>();
    
    for (const action of actionSeedData) {
      // Check if action already exists
      const existingAction = await queryRunner.query(
        `SELECT id FROM "actions" WHERE "action_code" = ?`,
        [action.actionCode],
      );

      let actionId: number;
      if (existingAction.length === 0) {
        const result = await queryRunner.query(
          `INSERT INTO "actions" ("name", "action_code", "description", "category", "created_at", "updated_at")
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [action.name, action.actionCode, action.description, action.category],
        );
        actionId = result.lastID;
      } else {
        actionId = existingAction[0].id;
      }
      actionMap.set(action.actionCode, actionId);
    }

    // Create initial permissions using actionId
    for (const permission of permissionSeedData) {
      const actionId = actionMap.get(permission.actionCode);
      if (!actionId) {
        throw new Error(`Action not found for permission: ${permission.name}`);
      }

      await queryRunner.query(
        `INSERT OR IGNORE INTO "permissions" ("resource_name", "action_id", "name", "description", "created_at", "updated_at")
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          permission.resourceName,
          actionId,
          permission.name,
          permission.description,
        ],
      );
    }

    // Create default roles if they don't exist
    const roleTableExists = await queryRunner.hasTable('roles');

    if (roleTableExists) {
      const roles = [
        {
          name: 'Super Admin',
          description: 'Has all permissions in the system',
        },
        { name: 'Admin', description: 'Has administrative permissions' },
        { name: 'User', description: 'Regular user with limited permissions' },
        { name: 'Guest', description: 'Guest user with minimal permissions' },
      ];

      for (const role of roles) {
        // Check if role already exists
        const existingRole = await queryRunner.query(
          `SELECT * FROM "roles" WHERE "name" = ?`,
          [role.name],
        );

        if (existingRole.length === 0) {
          await queryRunner.query(
            `INSERT INTO "roles" ("name", "description", "created_at", "updated_at") 
             VALUES (?, ?, datetime('now'), datetime('now'))`,
            [role.name, role.description],
          );
        }
      }

      // Get the Super Admin role ID
      const superAdminRole = await queryRunner.query(
        `SELECT * FROM "roles" WHERE "name" = 'Super Admin'`,
      );

      if (superAdminRole.length > 0) {
        const superAdminRoleId = superAdminRole[0].id;

        // Get all permission IDs
        const permissions = await queryRunner.query(
          `SELECT * FROM "permissions"`,
        );

        // Assign all permissions to Super Admin role
        for (const permission of permissions) {
          // Check if the permission is already assigned
          const existingRolePermission = await queryRunner.query(
            `SELECT * FROM "role_permissions" 
             WHERE "role_id" = ? AND "permission_id" = ?`,
            [superAdminRoleId, permission.id],
          );

          if (existingRolePermission.length === 0) {
            await queryRunner.query(
              `INSERT INTO "role_permissions" ("role_id", "permission_id", "is_granted", "created_at", "updated_at") 
               VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
              [superAdminRoleId, permission.id],
            );
          }
        }
      }

      // Get the Admin role ID
      const adminRole = await queryRunner.query(
        `SELECT * FROM "roles" WHERE "name" = 'Admin'`,
      );

      if (adminRole.length > 0) {
        const adminRoleId = adminRole[0].id;

        // Get specific permission IDs for Admin role
        const adminPermissionNames = [
          'users:view',
          'users:create',
          'users:edit',
          'roles:view',
          'groups:view',
          'permissions:view',
          'settings:view',
          'dashboard:view',
          'dashboard:edit',
        ];

        for (const permName of adminPermissionNames) {
          const permission = await queryRunner.query(
            `SELECT * FROM "permissions" WHERE "name" = ?`,
            [permName],
          );

          if (permission.length > 0) {
            // Check if the permission is already assigned
            const existingRolePermission = await queryRunner.query(
              `SELECT * FROM "role_permissions" 
               WHERE "role_id" = ? AND "permission_id" = ?`,
              [adminRoleId, permission[0].id],
            );

            if (existingRolePermission.length === 0) {
              await queryRunner.query(
                `INSERT INTO "role_permissions" ("role_id", "permission_id", "is_granted", "created_at", "updated_at") 
                 VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
                [adminRoleId, permission[0].id],
              );
            }
          }
        }
      }

      // Get the User role ID and assign basic permissions
      const userRole = await queryRunner.query(
        `SELECT * FROM "roles" WHERE "name" = 'User'`,
      );

      if (userRole.length > 0) {
        const userRoleId = userRole[0].id;

        // Get specific permission IDs for User role
        const userPermissionNames = ['dashboard:view'];

        for (const permName of userPermissionNames) {
          const permission = await queryRunner.query(
            `SELECT * FROM "permissions" WHERE "name" = ?`,
            [permName],
          );

          if (permission.length > 0) {
            // Check if the permission is already assigned
            const existingRolePermission = await queryRunner.query(
              `SELECT * FROM "role_permissions" 
               WHERE "role_id" = ? AND "permission_id" = ?`,
              [userRoleId, permission[0].id],
            );

            if (existingRolePermission.length === 0) {
              await queryRunner.query(
                `INSERT INTO "role_permissions" ("role_id", "permission_id", "is_granted", "created_at", "updated_at") 
                 VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
                [userRoleId, permission[0].id],
              );
            }
          }
        }
      }
    }

    // Create default groups if the groups table exists
    const groupTableExists = await queryRunner.hasTable('groups');

    if (groupTableExists) {
      const groups = [
        {
          name: 'IT Department',
          description: 'Information Technology Department',
        },
        { name: 'HR Department', description: 'Human Resources Department' },
        { name: 'Finance Department', description: 'Finance Department' },
        { name: 'Marketing Department', description: 'Marketing Department' },
      ];

      for (const group of groups) {
        // Check if group already exists
        const existingGroup = await queryRunner.query(
          `SELECT * FROM "groups" WHERE "name" = ?`,
          [group.name],
        );

        if (existingGroup.length === 0) {
          await queryRunner.query(
            `INSERT INTO "groups" ("name", "description", "created_at", "updated_at") 
             VALUES (?, ?, datetime('now'), datetime('now'))`,
            [group.name, group.description],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove seeded permissions
    await queryRunner.query(`
            DELETE FROM "permissions"
            WHERE name IN (${permissionSeedData.map((p) => `'${p.name}'`).join(',')})
        `);
  }
}
