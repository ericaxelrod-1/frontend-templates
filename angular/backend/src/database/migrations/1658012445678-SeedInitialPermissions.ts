import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedInitialPermissions1658012445678 implements MigrationInterface {
  name = 'SeedInitialPermissions1658012445678';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get action IDs for permission creation
    const createActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'CREATE'`,
    );
    const readActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'READ'`,
    );
    const updateActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'UPDATE'`,
    );
    const deleteActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'DELETE'`,
    );
    const manageActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'MANAGE'`,
    );
    const viewActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'VIEW'`,
    );
    const editActionResult = await queryRunner.query(
      `SELECT id FROM actions WHERE action_code = 'EDIT'`,
    );

    const createActionId = createActionResult[0]?.id;
    const readActionId = readActionResult[0]?.id;
    const updateActionId = updateActionResult[0]?.id;
    const deleteActionId = deleteActionResult[0]?.id;
    const manageActionId = manageActionResult[0]?.id;
    const viewActionId = viewActionResult[0]?.id;
    const editActionId = editActionResult[0]?.id;

    // Seed default permissions using action_id instead of actionName
    await queryRunner.query(`
            INSERT OR IGNORE INTO "permissions" (name, description, resource_name, action_id) VALUES
            
            -- Dashboard
            ('dashboard:view', 'Access the dashboard', 'dashboard', ${viewActionId}),
            
            -- User management
            ('users:view', 'View users', 'users', ${viewActionId}),
            ('users:create', 'Create users', 'users', ${createActionId}),
            ('users:update', 'Update users', 'users', ${updateActionId}),
            ('users:delete', 'Delete users', 'users', ${deleteActionId}),
            ('users:manage', 'Manage users', 'users', ${manageActionId}),
            
            -- Permissions management
            ('permissions:view', 'View permissions', 'permissions', ${viewActionId}),
            ('permissions:edit', 'Edit permissions', 'permissions', ${editActionId}),
            ('permissions:refresh', 'Refresh permissions', 'permissions', ${editActionId}),
            ('permissions:manage', 'Manage permissions', 'permissions', ${manageActionId}),
            
            -- Roles management
            ('roles:view', 'View roles', 'roles', ${viewActionId}),
            ('roles:create', 'Create roles', 'roles', ${createActionId}),
            ('roles:update', 'Update roles', 'roles', ${updateActionId}),
            ('roles:delete', 'Delete roles', 'roles', ${deleteActionId}),
            ('roles:manage', 'Manage roles', 'roles', ${manageActionId}),
            
            -- Groups management
            ('groups:view', 'View groups', 'groups', ${viewActionId}),
            ('groups:create', 'Create groups', 'groups', ${createActionId}),
            ('groups:update', 'Update groups', 'groups', ${updateActionId}),
            ('groups:delete', 'Delete groups', 'groups', ${deleteActionId}),
            ('groups:manage', 'Manage groups', 'groups', ${manageActionId}),
            
            -- System settings
            ('settings:view', 'View system settings', 'settings', ${viewActionId}),
            ('settings:edit', 'Edit system settings', 'settings', ${editActionId}),
            
            -- API access
            ('api:access', 'Access API endpoints', 'api', ${viewActionId})
        `);

    // Log permissions table content for debugging
    const currentPermissions = await queryRunner.query(
      `SELECT * FROM permissions`,
    );
    console.log(
      'Current permissions in DB after seeding:',
      currentPermissions.length,
      'permissions',
    );

    // Get role IDs (these should exist from the main migration)
    const userRoleResult = await queryRunner.query(
      `SELECT id FROM roles WHERE name = 'User'`,
    );
    const adminRoleResult = await queryRunner.query(
      `SELECT id FROM roles WHERE name = 'Administrator'`,
    );
    const superadminRoleResult = await queryRunner.query(
      `SELECT id FROM roles WHERE name = 'Super Administrator'`,
    );

    if (
      userRoleResult.length === 0 ||
      adminRoleResult.length === 0 ||
      superadminRoleResult.length === 0
    ) {
      console.warn(
        'Some roles not found. Skipping role-permission assignments.',
      );
      return;
    }

    const userRoleId = userRoleResult[0].id;
    const adminRoleId = adminRoleResult[0].id;
    const superadminRoleId = superadminRoleResult[0].id;

    // Create permission map for easy lookup
    const permissionsMap: Map<string, number> = new Map();
    const allSeededPermissions = await queryRunner.query(
      `SELECT id, name FROM permissions`,
    );
    allSeededPermissions.forEach((p) => permissionsMap.set(p.name, p.id));

    const rolePermissions = [
      // USER role permissions
      { roleId: userRoleId, permissionName: 'dashboard:view' },
      { roleId: userRoleId, permissionName: 'users:view' },

      // ADMIN role permissions
      { roleId: adminRoleId, permissionName: 'dashboard:view' },
      { roleId: adminRoleId, permissionName: 'users:view' },
      { roleId: adminRoleId, permissionName: 'users:create' },
      { roleId: adminRoleId, permissionName: 'users:update' },
      { roleId: adminRoleId, permissionName: 'users:delete' },
      { roleId: adminRoleId, permissionName: 'roles:view' },
      { roleId: adminRoleId, permissionName: 'roles:create' },
      { roleId: adminRoleId, permissionName: 'roles:update' },
      { roleId: adminRoleId, permissionName: 'permissions:view' },
      { roleId: adminRoleId, permissionName: 'groups:view' },
      { roleId: adminRoleId, permissionName: 'groups:create' },
      { roleId: adminRoleId, permissionName: 'groups:update' },
    ];

    // Assign specific permissions to roles
    for (const rp of rolePermissions) {
      const permissionId = permissionsMap.get(rp.permissionName);
      if (rp.roleId && permissionId) {
        await queryRunner.query(
          `INSERT OR IGNORE INTO "role_permissions" (role_id, permission_id, is_granted) VALUES (?, ?, 1)`,
          [rp.roleId, permissionId],
        );
      } else {
        console.warn(
          `Could not assign permission ${rp.permissionName} to role ID ${rp.roleId}. Role or Permission ID not found.`,
        );
      }
    }

    // Assign all permissions to SUPERADMIN
    if (superadminRoleId) {
      for (const [permissionName, permissionId] of permissionsMap.entries()) {
        await queryRunner.query(
          `INSERT OR IGNORE INTO "role_permissions" (role_id, permission_id, is_granted) VALUES (?, ?, 1)`,
          [superadminRoleId, permissionId],
        );
      }
    }

    // Register public routes (homepage, login, register) using correct column names
    await queryRunner.query(`
            INSERT OR IGNORE INTO "frontend_routes" (id, title, description, override_permissions) VALUES 
            ('/', 'Homepage', 'Homepage - public access', 1),
            ('/login', 'Login', 'Login page - public access', 1),
            ('/register', 'Register', 'Registration page - public access', 1),
            ('/forgot-password', 'Forgot Password', 'Password reset page - public access', 1),
            ('/reset-password', 'Reset Password', 'Password reset confirmation - public access', 1)
        `);

    // Register protected routes with required permissions
    await queryRunner.query(`
            INSERT OR IGNORE INTO "frontend_routes" (id, title, description, override_permissions, show_in_menu, menu_order) VALUES 
            ('/dashboard', 'Dashboard', 'Main dashboard', 0, 1, 1),
            ('/admin/users', 'User Management', 'User administration', 0, 1, 10),
            ('/admin/roles', 'Role Management', 'Role administration', 0, 1, 20),
            ('/admin/groups', 'Group Management', 'Group administration', 0, 1, 30),
            ('/admin/permissions', 'Permission Management', 'Permission administration', 0, 1, 40),
            ('/admin/settings', 'System Settings', 'System configuration', 0, 1, 50),
            ('/profile', 'Profile', 'User profile management', 0, 1, 100)
        `);

    // Create route-permission associations
    const dashboardPermissionId = permissionsMap.get('dashboard:view');
    const usersViewPermissionId = permissionsMap.get('users:view');
    const usersManagePermissionId = permissionsMap.get('users:manage');
    const rolesManagePermissionId = permissionsMap.get('roles:manage');
    const groupsManagePermissionId = permissionsMap.get('groups:manage');
    const permissionsManagePermissionId =
      permissionsMap.get('permissions:manage');
    const settingsEditPermissionId = permissionsMap.get('settings:edit');

    // Associate routes with permissions
    if (dashboardPermissionId) {
      await queryRunner.query(
        `INSERT OR IGNORE INTO "frontend_route_permissions" (frontend_route_id, permission_id) VALUES (?, ?)`,
        ['/dashboard', dashboardPermissionId],
      );
    }

    if (usersViewPermissionId) {
      await queryRunner.query(
        `INSERT OR IGNORE INTO "frontend_route_permissions" (frontend_route_id, permission_id) VALUES (?, ?)`,
        ['/profile', usersViewPermissionId],
      );
    }

    if (usersManagePermissionId) {
      await queryRunner.query(
        `INSERT OR IGNORE INTO "frontend_route_permissions" (frontend_route_id, permission_id) VALUES (?, ?)`,
        ['/admin/users', usersManagePermissionId],
      );
    }

    if (rolesManagePermissionId) {
      await queryRunner.query(
        `INSERT OR IGNORE INTO "frontend_route_permissions" (frontend_route_id, permission_id) VALUES (?, ?)`,
        ['/admin/roles', rolesManagePermissionId],
      );
    }

    if (groupsManagePermissionId) {
      await queryRunner.query(
        `INSERT OR IGNORE INTO "frontend_route_permissions" (frontend_route_id, permission_id) VALUES (?, ?)`,
        ['/admin/groups', groupsManagePermissionId],
      );
    }

    if (permissionsManagePermissionId) {
      await queryRunner.query(
        `INSERT OR IGNORE INTO "frontend_route_permissions" (frontend_route_id, permission_id) VALUES (?, ?)`,
        ['/admin/permissions', permissionsManagePermissionId],
      );
    }

    if (settingsEditPermissionId) {
      await queryRunner.query(
        `INSERT OR IGNORE INTO "frontend_route_permissions" (frontend_route_id, permission_id) VALUES (?, ?)`,
        ['/admin/settings', settingsEditPermissionId],
      );
    }

    console.log('Successfully seeded permissions, roles, and routes');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove route-permission associations
    await queryRunner.query(`DELETE FROM "frontend_route_permissions"`);

    // Remove routes
    await queryRunner.query(`DELETE FROM "frontend_routes"`);

    // Remove role-permission associations
    await queryRunner.query(`DELETE FROM "role_permissions"`);

    // Remove permissions
    await queryRunner.query(`DELETE FROM "permissions"`);

    console.log('Rolled back permission seeding');
  }
}
