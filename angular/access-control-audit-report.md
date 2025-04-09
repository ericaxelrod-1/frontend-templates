# Access Control Audit Report
Generated on 2025-04-08 19:27:27

**Backend Directory Path:** backend
**Frontend Directory Path:** frontend

## 1. Backend Hardcoded Role Definitions

### 1.1 Role Enums and Type Definitions

```
backend\src\modules\users\roles.service.ts:8: interface RolePermissions {
backend\src\modules\users\entities\role.entity.ts:6: export type SystemRoleType = 'user' | 'admin' | 'superuser' | 'superadmin' | string;
backend\node_modules\typescript\lib\lib.dom.d.ts:29542: type RTCDtlsRole = "client" | "server" | "unknown";
backend\node_modules\typescript\lib\lib.dom.d.ts:29552: type RTCIceRole = "controlled" | "controlling" | "unknown";
backend\node_modules\typeorm\driver\mongodb\typings.d.ts:4600: export declare interface RoleSpecification {
backend\node_modules\typeorm\browser\driver\mongodb\typings.d.ts:4600: export declare interface RoleSpecification {
backend\dist\modules\users\entities\role.entity.d.ts:2: export type SystemRoleType = 'user' | 'admin' | 'superuser' | 'superadmin' | string;
```

### 1.2 Hardcoded Role Names

```
backend\src\migrations\1658012445678-SeedInitialPermissions.ts:10: (uuid_generate_v4(), 'USER', 'Regular user with basic access'),
backend\src\migrations\1658012445678-SeedInitialPermissions.ts:11: (uuid_generate_v4(), 'ADMIN', 'Administrator with management permissions'),
backend\src\migrations\1658012445678-SeedInitialPermissions.ts:12: (uuid_generate_v4(), 'SUPERADMIN', 'Super administrator with full access')
backend\src\migrations\1658012445678-SeedInitialPermissions.ts:66: const userRoleResult = await queryRunner.query(`SELECT id FROM roles WHERE name = 'USER'`);
backend\src\migrations\1658012445678-SeedInitialPermissions.ts:67: const adminRoleResult = await queryRunner.query(`SELECT id FROM roles WHERE name = 'ADMIN'`);
backend\src\migrations\1658012445678-SeedInitialPermissions.ts:68: const superadminRoleResult = await queryRunner.query(`SELECT id FROM roles WHERE name = 'SUPERADMIN'`);
backend\src\database\migrations\1658012445678-SeedInitialPermissions.ts:10: (uuid_generate_v4(), 'USER', 'Regular user with basic access'),
backend\src\database\migrations\1658012445678-SeedInitialPermissions.ts:11: (uuid_generate_v4(), 'ADMIN', 'Administrator with management permissions'),
backend\src\database\migrations\1658012445678-SeedInitialPermissions.ts:12: (uuid_generate_v4(), 'SUPERADMIN', 'Super administrator with full access')
backend\src\database\migrations\1658012445678-SeedInitialPermissions.ts:66: const userRoleResult = await queryRunner.query(`SELECT id FROM roles WHERE name = 'USER'`);
backend\src\database\migrations\1658012445678-SeedInitialPermissions.ts:67: const adminRoleResult = await queryRunner.query(`SELECT id FROM roles WHERE name = 'ADMIN'`);
backend\src\database\migrations\1658012445678-SeedInitialPermissions.ts:68: const superadminRoleResult = await queryRunner.query(`SELECT id FROM roles WHERE name = 'SUPERADMIN'`);
```

### 1.3 Role-Based Guards and Decorators

```
backend\src\modules\permissions\actions.controller.ts:27: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\actions.controller.ts:35: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\actions.controller.ts:44: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\actions.controller.ts:56: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\actions.controller.ts:72: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:38: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:47: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:57: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:70: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:86: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:97: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:106: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:118: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:130: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:143: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:152: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:164: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:176: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:189: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:198: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:210: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\permissions.controller.ts:222: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\resources.controller.ts:27: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\resources.controller.ts:35: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\permissions\resources.controller.ts:44: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\resources.controller.ts:56: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\permissions\resources.controller.ts:72: @Roles(SystemRoles.SUPERADMIN)
backend\src\modules\users\users.controller.ts:43: @Roles(SystemRoles.SUPERUSER, SystemRoles.SUPERADMIN)
backend\src\modules\users\users.controller.ts:54: @Roles(SystemRoles.SUPERUSER, SystemRoles.SUPERADMIN)
backend\src\modules\users\users.controller.ts:65: @Roles(SystemRoles.SUPERUSER, SystemRoles.SUPERADMIN)
backend\src\modules\users\users.controller.ts:138: @Roles(SystemRoles.SUPERUSER, SystemRoles.SUPERADMIN)
backend\src\modules\auth\controllers\login-monitoring.controller.ts:26: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\auth\controllers\login-monitoring.controller.ts:41: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\auth\controllers\login-monitoring.controller.ts:60: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\auth\controllers\login-monitoring.controller.ts:101: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
backend\src\modules\auth\controllers\login-monitoring.controller.ts:125: @Roles(SystemRoles.ADMIN, SystemRoles.SUPERADMIN)
```

### 1.4 Seed Data and Migrations with Hardcoded Roles

```
backend\src\modules\auth\auth.service.spec.ts:178: role: defaultRole,
backend\src\modules\auth\auth.service.ts:211: role: user.role,
backend\src\modules\auth\auth.service.ts:276: role: defaultRole,
backend\src\modules\permissions\permissions.service.spec.ts:164: const user = { id: 1, role: { id: 1 } };
backend\src\modules\permissions\permissions.service.spec.ts:184: const user = { id: 1, role: { id: 1 } };
backend\src\modules\permissions\permissions.service.spec.ts:205: const user = { id: 1, role: { id: 1 } };
backend\src\modules\permissions\permissions.service.ts:521: role: { id: user.role.id },
backend\src\modules\users\groups.service.spec.ts:74: const currentUser = { id: 1, role: { name: 'User', permissions: { canManageGroups: true } } };
backend\src\modules\users\groups.service.spec.ts:108: const currentUser = { id: 1, role: { name: 'User' } };
backend\src\modules\users\groups.service.spec.ts:130: const currentUser = { id: 1, role: { name: 'User' } };
backend\src\modules\users\groups.service.spec.ts:169: const currentUser = { id: 1, role: { name: 'User' } };
backend\src\modules\users\groups.service.spec.ts:206: const currentUser = { id: 1, role: { name: 'User' } };
backend\src\modules\users\groups.service.spec.ts:241: const currentUser = { id: 1, role: { name: 'User' } };
backend\src\modules\users\roles.controller.ts:66: @Body() createRoleDto: CreateRoleDto,
backend\src\modules\users\roles.controller.ts:69: return this.rolesService.create(createRoleDto, currentUser);
backend\src\modules\users\roles.service.spec.ts:81: const currentUser = { id: 1, role: { name: UserRole.SUPERADMIN } };
backend\src\modules\users\roles.service.spec.ts:103: const nonAdminUser = { id: 2, role: { name: UserRole.USER } };
backend\src\modules\users\roles.service.spec.ts:111: const currentUser = { id: 1, role: { name: 'Superadmin', permissions: { canManageRoles: true } } };
backend\src\modules\users\roles.service.spec.ts:114: const user = { id: 2, role: { name: 'User' } };
backend\src\modules\users\roles.service.spec.ts:119: mockUserRepository.save.mockResolvedValue({ ...user, role: newRole });
backend\src\modules\users\roles.service.spec.ts:122: expect(result).toEqual({ ...user, role: newRole });
backend\src\modules\users\roles.service.spec.ts:127: const nonAdminUser = { id: 2, role: { name: 'User', permissions: { canManageRoles: false } } };
backend\src\modules\users\roles.service.ts:135: async create(createRoleDto: any, currentUser: User): Promise<Role> {
backend\src\modules\users\roles.service.ts:145: const existingRole = await this.rolesRepository.findOne({ where: { name: createRoleDto.name } });
backend\src\modules\users\roles.service.ts:147: throw new ForbiddenException(`Role with name ${createRoleDto.name} already exists`);
backend\src\modules\users\roles.service.ts:151: name: createRoleDto.name,
backend\src\modules\users\roles.service.ts:152: description: createRoleDto.description || `Custom role: ${createRoleDto.name}`,
backend\src\modules\users\roles.service.ts:159: if (createRoleDto.permissions) {
backend\src\modules\users\roles.service.ts:161: // await this.permissionsService.assignPermissionsToRole(savedRole.id, createRoleDto.permissions);
backend\src\modules\users\users.service.spec.ts:90: role: defaultRole,
backend\src\modules\users\users.service.spec.ts:110: role: defaultRole,
backend\src\modules\permissions\entities\role-permission.entity.ts:23: // role: Role;
backend\src\modules\permissions\scanners\manifest.service.ts:171: // Skip special format permissions (like 'role:ADMIN')
backend\src\modules\permissions\scanners\manifest.service.ts:172: if (permString.startsWith('role:')) {
backend\src\modules\auth\decorators\roles.decorator.ts:18: const permissions = roles.map(role => `role:${role}`);
backend\src\modules\auth\decorators\roles.decorator.ts:31: export const HasSystemRole = (role: string) => {
backend\src\modules\auth\decorators\roles.decorator.ts:34: `Called with role: ${role}`
backend\src\modules\auth\decorators\roles.decorator.ts:36: return `role:${role}`;
backend\src\modules\auth\guards\role.guard.ts:49: const rolePermissions = requiredRoles.map(role => `role:${role}`);
backend\src\modules\auth\guards\role.guard.ts:59: // Special case: If user has 'role:SUPERADMIN' permission, always grant access
backend\src\modules\auth\guards\role.guard.ts:60: const hasSuperAdmin = userPermissions.includes(`role:${SystemRoles.SUPERADMIN}`);
backend\src\db\seeds\permission-seed.service.ts:226: let role: Role;
backend\src\db\seeds\role-migration.seed.ts:58: // Create special 'role:ROLE_NAME' permissions for backward compatibility
backend\src\db\seeds\role-migration.seed.ts:59: await this.createRoleToPermissionMappings();
backend\src\db\seeds\role-migration.seed.ts:72: private async createRoleToPermissionMappings(): Promise<void> {
backend\src\db\seeds\role-migration.seed.ts:78: const permissionName = `role:${role.name}`;
backend\src\db\seeds\role-migration.seed.ts:94: description: `Special permission for role: ${role.name} (for backward compatibility)`,
backend\src\db\seeds\role-migration.seed.ts:143: this.logger.log(`Assigned ${permissionNames.length} permissions to role: ${roleName}`);
backend\src\db\seeds\role-migration.seed.ts:149: private async assignPermissionToRole(role: Role, permission: Permission): Promise<void> {
backend\src\db\seeds\role-seed.service.ts:47: this.logger.log(`Created role: ${role.name}`);
backend\src\database\seeds\initial.seed.ts:75: console.log(`Created role: ${roleData.name}`);
backend\src\database\seeds\users.seed.ts:33: role: superadminRole,
backend\src\database\seeds\users.seed.ts:48: role: superuserRole,
backend\src\database\seeds\users.seed.ts:63: role: regularRole,
backend\node_modules\typescript\lib\lib.dom.d.ts:2550: role: string | null;
backend\node_modules\typeorm\driver\mongodb\typings.d.ts:4605: role: string;
backend\node_modules\typeorm\browser\driver\mongodb\typings.d.ts:4605: role: string;
backend\node_modules\@nestjs\common\decorators\http\route-params.decorator.d.ts:277: * async create(@Body('role', new ValidationPipe()) role: string)
backend\node_modules\@nestjs\cli\node_modules\typescript\lib\lib.dom.d.ts:2487: role: string | null;
backend\dist\modules\auth\auth.controller.d.ts:13: role: any;
backend\dist\modules\auth\auth.service.d.ts:33: role: any;
backend\dist\modules\users\roles.controller.d.ts:17: create(createRoleDto: CreateRoleDto, currentUser: User): Promise<Role>;
backend\dist\modules\users\roles.service.d.ts:14: create(createRoleDto: any, currentUser: User): Promise<Role>;
```

### 1.5 Critical File: role.entity.ts

**Location:** backend\src\modules\users\entities\role.entity.ts

```typescript
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, JoinColumn, ManyToMany } from 'typeorm';
import { User } from './user.entity';
// import { RolePermission } from '../../permissions/entities/role-permission.entity';

// Define role types as a string literal type - this provides type safety while allowing flexibility
export type SystemRoleType = 'user' | 'admin' | 'superuser' | 'superadmin' | string;

// Define the constants for standard system roles
export const SystemRoles = {
  USER: 'user' as SystemRoleType,
  ADMIN: 'admin' as SystemRoleType,
  SUPERUSER: 'superuser' as SystemRoleType,
  SUPERADMIN: 'superadmin' as SystemRoleType
};

// Alias for backward compatibility
export const UserRole = SystemRoles;

@Entity({ name: 'roles' })
export class Role {
```

## 2. Frontend Hardcoded Access Controls

### 2.1 Route Definitions with Hardcoded Roles

```
frontend\src\app\app-routing.module.ts:42: permissionRule: 'roles:manage'
frontend\src\app\app.routes.ts:71: permissionRule: 'roles:list'
frontend\src\app\store\auth\auth.state.ts:230: console.log('LoginSuccess - User roles:', action.user?.roles);
frontend\src\app\store\auth\auth.state.ts:490: console.log('AppInitialize: User roles:', user.roles);
frontend\src\app\shared\directives\has-permission.directive.spec.ts:13: <div *hasPermission="'roles:read'; else noAccess">Content for roles:read</div>
frontend\src\app\shared\directives\has-permission.directive.spec.ts:109: expect(content).not.toContain('Content for roles:read');
frontend\src\app\shared\directives\has-permission.directive.spec.ts:125: if (permission === 'roles:read') {
frontend\src\app\shared\directives\has-permission.directive.spec.ts:136: expect(elements[0].nativeElement.textContent).toBe('Content for roles:read');
frontend\src\app\features\auth\auth.service.ts:13: roles: string[];
frontend\src\app\features\roles\roles.component.ts:142: roles: Role[] = [];
frontend\src\app\features\roles\roles.component.ts:160: this.permissionService.hasPermission('roles:view').subscribe(hasPermission => {
frontend\src\app\features\roles\roles.component.ts:181: console.error('Error loading roles:', error);
frontend\src\app\features\admin\permissions-management\role-permissions\role-permissions.component.ts:18: roles: Role[] = [];
frontend\src\app\features\admin\permissions-management\role-permissions\role-permissions.component.ts:61: console.error('Error loading roles:', error);
frontend\src\app\core\constants\roles.ts:77: console.log('Loaded system roles:', SystemRoles);
frontend\src\app\core\services\auth.service.ts:57: console.log('Updating role translations from loaded roles:', roles);
frontend\src\app\core\services\auth.service.ts:63: private updateRoleTranslations(roles: Record<string, string>): void {
frontend\src\app\core\services\auth.service.ts:124: console.log('Current user roles:', this.currentUser.roles);
frontend\src\app\core\services\auth.service.ts:212: roles: []
frontend\src\app\core\services\auth.service.ts:442: roles: ['user'],
frontend\src\app\core\services\permission.service.spec.ts:163: const mockPermissions = ['users:read', 'users:list', 'roles:read'];
frontend\src\app\core\services\permission.service.spec.ts:183: const mockPermissions = ['users:read', 'users:list', 'roles:read'];
frontend\src\app\core\services\permission.service.spec.ts:184: service['permissionCache'].set('roles:write', false);
frontend\src\app\core\services\permission.service.spec.ts:247: const result$ = service.hasAnyPermission(['users:write', 'roles:read']);
frontend\src\app\core\services\permission.service.spec.ts:270: service['userPermissionsSubject'].next(['users:read', 'users:list', 'roles:read']);
frontend\src\app\core\services\permission.service.spec.ts:273: const result$ = service.hasAllPermissions(['users:read', 'roles:read']);
frontend\src\app\core\services\permission.service.spec.ts:287: const result$ = service.hasAllPermissions(['users:read', 'roles:read']);
frontend\src\app\core\services\permission.service.spec.ts:312: const mockPermissions = ['users:read', 'users:list', 'roles:read'];
frontend\node_modules\@tufjs\models\dist\root.d.ts:21: readonly roles: RoleMap;
```

### 2.2 Template Role Checks

```
frontend\src\app\layouts\sidebar\sidebar.component.html:16: <ng-container *ngIf="isAdminOrProjectManager">
frontend\src\app\features\auth\profile\profile.component.html:59: <p *ngIf="user.roles && user.roles.length"><strong>Roles:</strong> {{user.roles.join(', ')}}</p>
frontend\src\app\features\admin\permissions-management\role-permissions\role-permissions.component.html:33: <span class="chip" *ngIf="role.permissions?.length">
frontend\src\app\features\admin\permissions-management\role-permissions\role-permissions.component.html:36: <span class="chip empty" *ngIf="!role.permissions?.length">
```

### 2.3 Component Role Checks

```
frontend\src\app\store\auth\auth.state.ts:490: console.log('AppInitialize: User roles:', user.roles);
frontend\src\app\layouts\sidebar\sidebar.component.ts:52: get isSuperAdmin(): boolean {
frontend\src\app\layouts\sidebar\sidebar.component.ts:53: const result = this.authService.hasRole('SUPERADMIN');
frontend\src\app\layouts\sidebar\sidebar.component.ts:54: console.log('[SidebarComponent] hasRole SUPERADMIN:', result);
frontend\src\app\layouts\sidebar\sidebar.component.ts:60: const hasAdmin = this.authService.hasRole('ADMIN');
frontend\src\app\layouts\sidebar\sidebar.component.ts:61: const hasPM = this.authService.hasRole('PROJECT_MANAGER');
frontend\src\app\layouts\sidebar\sidebar.component.ts:62: console.log('[SidebarComponent] hasRole ADMIN:', hasAdmin, 'PROJECT_MANAGER:', hasPM);
frontend\src\app\layouts\sidebar\sidebar.component.ts:67: const result = this.authService.hasRole('SUPERADMIN');
frontend\src\app\layouts\sidebar\sidebar.component.ts:72: const hasAdmin = this.authService.hasRole('ADMIN');
frontend\src\app\layouts\sidebar\sidebar.component.ts:73: const hasPM = this.authService.hasRole('PROJECT_MANAGER');
frontend\src\app\features\users\users.component.ts:73: <td mat-cell *matCellDef="let user">{{ user.role || 'User' }}</td>
frontend\src\app\core\services\auth.service.ts:110: hasRole(role: string): boolean {
frontend\src\app\core\services\auth.service.ts:111: console.log('hasRole check for:', role);
frontend\src\app\core\services\auth.service.ts:131: const hasRole = this.currentUser.roles.some(r =>
frontend\src\app\core\services\auth.service.ts:140: console.log('Has direct role:', hasRole);
frontend\src\app\core\services\auth.service.ts:143: return hasRole || isSuperAdmin;
```

### 2.4 Critical File: role.guard.ts

**Location:** frontend\src\app\core\guards\role.guard.ts

```typescript
import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { Store } from '@ngxs/store';
import { AuthState } from '../../store/auth/auth.state';
import { PermissionService } from '../services/permission.service';
import { map, catchError } from 'rxjs/operators';
import { User } from '../../models/user.model';

// Define permission rule interfaces
type PermissionRule = string | string[] | { all: string[] };

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  
  constructor(
    private authService: AuthService,
    private router: Router,
    private store: Store,
    private permissionService: PermissionService
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    // Get the current user
    const isAuthenticated = this.store.selectSnapshot(AuthState.isAuthenticated);
    const currentUser = this.store.selectSnapshot(AuthState.user) as User | null;
    console.log('[RoleGuard] Current user:', currentUser);
    
    // Redirect to login if not authenticated
    if (!isAuthenticated || !currentUser) {
      console.log('[RoleGuard] User not authenticated, redirecting to login');
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    // Check for permission rules
    const permissionRule = route.data['permissionRule'] as PermissionRule;
    if (!permissionRule) {
      console.log('[RoleGuard] No permission rule defined, denying access');
      this.router.navigate(['/app/dashboard']);
      return false;
    }
    
    console.log('[RoleGuard] Checking permission rule:', permissionRule);
    
    // Handle different permission rule formats
    if (typeof permissionRule === 'string') {
      // Single permission string (e.g., 'users:manage')
      return this.permissionService.hasPermission(permissionRule).pipe(
        map(hasPermission => {
          if (!hasPermission) {
            console.log('[RoleGuard] Permission denied, redirecting to dashboard');
            this.router.navigate(['/app/dashboard']);
          }
          return hasPermission;
        }),
        catchError(() => {
          this.router.navigate(['/app/dashboard']);
          return of(false);
        })
      );
    } 
    else if (Array.isArray(permissionRule)) {
      // Array of permissions (any of them)
      return this.permissionService.hasAnyPermission(permissionRule).pipe(
        map(hasAnyPermission => {
          if (!hasAnyPermission) {
            console.log('[RoleGuard] No permissions granted, redirecting to dashboard');
            this.router.navigate(['/app/dashboard']);
          }
          return hasAnyPermission;
        }),
        catchError(() => {
          this.router.navigate(['/app/dashboard']);
          return of(false);
        })
      );
    }
    else if (permissionRule.all && Array.isArray(permissionRule.all)) {
      // Object with 'all' property for requiring all permissions
      return this.permissionService.hasAllPermissions(permissionRule.all).pipe(
        map(hasAllPermissions => {
          if (!hasAllPermissions) {
            console.log('[RoleGuard] Not all permissions granted, redirecting to dashboard');
            this.router.navigate(['/app/dashboard']);
          }
          return hasAllPermissions;
        }),
        catchError(() => {
          this.router.navigate(['/app/dashboard']);
          return of(false);
        })
      );
    }
    
    // If we get here, the permission rule format is invalid
    console.log('[RoleGuard] Invalid permission rule format, denying access');
    this.router.navigate(['/app/dashboard']);
    return false;
  }
} 
```

### 2.5 Critical File: auth.service.ts (hasRole method)

**Location:** frontend\src\app\core\services\auth.service.ts

```typescript
ed role, false otherwise
   */
  hasRole(role: string): boolean {
    console.log('hasRole check for:', role);
```

### 2.6 Critical File: app.routes.ts

**Location:** frontend\src\app\app.routes.ts

```typescript
import { Routes } from '@angular/router';
import { AuthGuard, RoleGuard, PasswordChangeGuard } from './core/guards';

// Layout components
import { DefaultLayoutComponent } from './layouts/default/default.component';
import { AdminLayoutComponent } from './layouts/admin/admin.component';

/**
 * Main application routes
 * 
 * Permission-based routes should use the following format for data:
 * { permissionRule: 'resource:action' } OR
 * { permissionRule: ['resource1:action1', 'resource2:action2'] } OR 
 * { permissionRule: { all: ['resource1:action1', 'resource2:action2'] } }
 */
export const routes: Routes = [
  {
    path: 'app',
    component: DefaultLayoutComponent,
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.routes),
        canActivate: [AuthGuard]
      },
      {
        path: 'profile',
        loadChildren: () => import('./features/profile/profile.routes').then(m => m.routes),
        canActivate: [AuthGuard]
      },
      {
        path: 'profile/change-password',
        loadComponent: () => import('./features/profile/password-change/password-change.component').then(c => c.PasswordChangeComponent),
        canActivate: [AuthGuard]
      },
      {
        path: 'users',
        loadChildren: () => import('./features/users/users.routes').then(m => m.routes),
        canActivate: [RoleGuard],
        data: { 
          permissionRule: 'users:list'
        }
      },
      {
        path: 'users/create',
        loadComponent: () => import('./features/users/create-user.component').then(c => c.CreateUserComponent),
        canActivate: [RoleGuard],
        data: { 
          permissionRule: 'users:create'
        }
      },
      {
        path: 'groups',
        loadComponent: () => import('./features/groups/groups.component').then(c => c.GroupsComponent),
        canActivate: [RoleGuard],
        data: { 
          permissionRule: 'groups:list'
        }
      },
      {
        path: 'roles',
        loadComponent: () => import('./features/roles/roles.component').then(c => c.RolesComponent),
        canActivate: [RoleGuard],
        data: { 
          permissionRule: 'roles:list'
        }
      }
    ]
  },
  {
    path: 'admin',
    component: AdminLayoutComponent,
    canActivate: [AuthGuard, PasswordChangeGuard, RoleGuard],
    data: { 
      permissionRule: 'admin:access'
    },
    loadChildren: () => import('./modules/admin/admin.module').then(m => m.AdminModule)
  },
  {
    path: '',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.routes)
  },
  {
    path: '**',
    redirectTo: '/login'
  }
];

```

## 3. Summary of Findings

| Category | Count |
|----------|-------|
| Backend Hardcoded Roles | 12 |
| Frontend TypeScript Hardcoded Roles | 11 |
| Frontend Template Role Checks | 4 |
| Route Definitions with Roles | 29 |
| **Total Hardcoded Instances** | **27** |

## 4. Critical Files Requiring Migration

1. backend/src/modules/users/entities/role.entity.ts
2. frontend/src/app/core/guards/role.guard.ts
3. frontend/src/app/core/services/auth.service.ts
4. frontend/src/app/app.routes.ts
5. frontend/src/app/modules/admin/admin.module.ts

## 5. Next Steps

1. Create database schema changes for hierarchical roles and groups
2. Implement permission entities and services
3. Update role.entity.ts to use database-driven approach
4. Create permission-based guards to replace role-based guards
5. Develop frontend permission services and directives
6. Migrate all hardcoded instances to use the new permission system

