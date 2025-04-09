// Original role-based route configuration
const originalRoutes = [
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: {
      roles: ['ADMIN', 'SUPERADMIN']
    },
    children: [
      {
        path: 'users',
        component: UserListComponent,
        canActivate: [AuthGuard, RoleGuard],
        data: {
          roles: ['ADMIN', 'SUPERADMIN']
        }
      },
      {
        path: 'reports',
        component: ReportsComponent,
        canActivate: [AuthGuard, RoleGuard],
        data: {
          roles: ['ADMIN', 'SUPERADMIN', 'PROJECT_MANAGER']
        }
      }
    ]
  },
  {
    path: 'profile',
    component: ProfileComponent,
    canActivate: [AuthGuard]
  }
];

// -----------------------------------------------------
// New permission-based route configuration
// -----------------------------------------------------

import { AuthGuard } from '../guards/auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { AdminComponent } from '../components/admin/admin.component';
import { UserListComponent } from '../components/admin/user-list.component';
import { ReportsComponent } from '../components/admin/reports.component';
import { ProfileComponent } from '../components/profile/profile.component';

/**
 * Permission-based route configuration using the new PermissionGuard.
 * 
 * Instead of checking against hardcoded role names, we now check against
 * specific resource-action combinations that represent permissions.
 * 
 * This is more flexible and allows for fine-grained access control.
 */
const permissionBasedRoutes = [
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      permission: {
        resource: 'admin',
        action: 'access',
        redirectUrl: '/access-denied'
      }
    },
    children: [
      {
        path: 'users',
        component: UserListComponent,
        canActivate: [PermissionGuard],
        data: {
          permission: {
            resource: 'user',
            action: 'read'
          }
        }
      },
      {
        path: 'reports',
        component: ReportsComponent,
        canActivate: [PermissionGuard],
        data: {
          // For routes that were previously accessible by multiple roles,
          // we can define a specific permission that encompasses that functionality
          permission: {
            resource: 'report',
            action: 'read'
          }
        }
      }
    ]
  },
  {
    path: 'profile',
    component: ProfileComponent,
    canActivate: [AuthGuard]
    // No permission check needed as all authenticated users can access their profile
  }
];

// -----------------------------------------------------
// Migration mapping between roles and permissions
// -----------------------------------------------------

/**
 * Migration mapping to convert role-based routes to permission-based routes.
 * 
 * This mapping helps understand which permissions should be assigned to each role
 * during the migration process.
 */
const rolesToPermissionsMapping = {
  // Standard user permissions
  'USER': [
    { resource: 'profile', action: 'read' },
    { resource: 'profile', action: 'update' }
  ],
  
  // Admin permissions
  'ADMIN': [
    { resource: 'admin', action: 'access' },
    { resource: 'user', action: 'read' },
    { resource: 'user', action: 'create' },
    { resource: 'user', action: 'update' },
    { resource: 'report', action: 'read' }
  ],
  
  // Project manager permissions
  'PROJECT_MANAGER': [
    { resource: 'report', action: 'read' },
    { resource: 'report', action: 'create' },
    { resource: 'project', action: 'manage' }
  ],
  
  // Superuser permissions
  'SUPERUSER': [
    { resource: 'admin', action: 'access' },
    { resource: 'user', action: 'read' },
    { resource: 'user', action: 'create' },
    { resource: 'user', action: 'update' },
    { resource: 'user', action: 'delete' },
    { resource: 'report', action: 'read' },
    { resource: 'report', action: 'create' },
    { resource: 'report', action: 'update' },
    { resource: 'report', action: 'delete' },
    { resource: 'system', action: 'configure' }
  ],
  
  // Superadmin permissions - has all permissions
  'SUPERADMIN': [
    { resource: 'admin', action: 'access' },
    { resource: 'user', action: 'read' },
    { resource: 'user', action: 'create' },
    { resource: 'user', action: 'update' },
    { resource: 'user', action: 'delete' },
    { resource: 'role', action: 'read' },
    { resource: 'role', action: 'create' },
    { resource: 'role', action: 'update' },
    { resource: 'role', action: 'delete' },
    { resource: 'role', action: 'assign' },
    { resource: 'report', action: 'read' },
    { resource: 'report', action: 'create' },
    { resource: 'report', action: 'update' },
    { resource: 'report', action: 'delete' },
    { resource: 'system', action: 'configure' },
    { resource: 'permission', action: 'manage' },
    { resource: 'audit', action: 'read' }
  ]
}; 