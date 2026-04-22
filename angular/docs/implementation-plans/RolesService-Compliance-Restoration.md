# RolesService Compliance Restoration

## Problem

During the bugfix pass the entire [roles/roles.service.ts](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts) was reverted to the
pre-merge version (381 lines). The controller was **not** reverted and still calls
service methods that no longer exist. This is a silent runtime failure — no build
error because TypeScript's strict-function-call checking is not fully enforced in
this project's config.

---

## Current State vs Required State

| Method | Current service | Controller calls | Status |
|---|---|---|---|
| [create(dto)](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#55-83) | ✅ exists | [create(dto, currentUser)](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#55-83) | ❌ wrong signature |
| [findAll()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#37-43) | returns `Role[]` | expects `{items,total,page,pageSize}` | ❌ wrong return |
| [update(id, dto)](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.controller.ts#102-109) | ✅ exists | [update(id, dto, currentUser)](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.controller.ts#102-109) | ❌ wrong signature |
| [remove(id)](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#111-123) | ✅ exists | [remove(id, currentUser)](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#111-123) | ❌ wrong signature |
| `updateRolePermissions()` | ❌ missing | called at `PUT /:id/permissions` | ❌ runtime crash |
| `assignRoleToUser()` | ❌ missing | called at `PUT /users/:userId/role` | ❌ runtime crash |
| [findRoleById()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#52-69) | ✅ exists | (private helper) | ✅ |
| [getRolePermissions()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#151-155) | ✅ fixed | `GET /:id/permissions` | ✅ |
| [clearPermissionCaches()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#373-380) | empty body | called on write ops | ❌ cache never cleared |
| [onModuleInit()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/packages/nestjs-typeorm-rls/src/rls-bootstrap.service.ts#19-22)/`ensureSystemRoles()` | ❌ missing | startup | ❌ no system roles |
| `transformRoleForFrontend()` | ❌ missing | called internally | ❌ wrong response shape |
| `hasUserPermission()` | ❌ missing | used by create/update/remove | ❌ |
| `getPermissionsService()` | ❌ missing | used by bootstrap | ❌ |

---

## Required Changes

### [MODIFY] [roles.service.ts](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts)

#### 1 — Restore imports and constructor

Replace the current minimal imports + constructor with the full merged version:

```typescript
import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, OnModuleInit, Inject, forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, ILike } from 'typeorm';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { User } from '../users/entities/user.entity';
import { PermissionsService } from '../permissions/services/permissions.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    @InjectRepository(Role) private roleRepository: Repository<Role>,
    @InjectRepository(RolePermission) private rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission) private permissionRepository: Repository<Permission>,
    @InjectRepository(User) private usersRepository: Repository<User>,
    private moduleRef: ModuleRef,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}
```

#### 2 — Add private helpers

Add these three private methods (before [create()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#55-83)):

```typescript
private async getPermissionsService(): Promise<PermissionsService> {
  return this.moduleRef.get(PermissionsService, { strict: false });
}

private async hasUserPermission(userId: number, resource: string, action: string): Promise<boolean> {
  try {
    const permissionsService = await this.getPermissionsService();
    return await permissionsService.checkUserPermission(userId, resource, action);
  } catch (error) {
    console.error(`Error checking permission: ${error.message}`);
    return false;
  }
}

private transformRoleForFrontend(role: Role): Role {
  if (role.rolePermissions) {
    const permissions = role.rolePermissions
      .filter((rp) => rp.isGranted && rp.permission)
      .map((rp) => rp.permission);
    return { ...role, permissions, rolePermissions: undefined } as any;
  }
  return role;
}
```

#### 3 — Add [onModuleInit](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/packages/nestjs-typeorm-rls/src/rls-bootstrap.service.ts#19-22) bootstrap

Add after the private helpers:

```typescript
async onModuleInit() {
  await this.ensureSystemRoles();
}

async ensureSystemRoles() {
  const standardRoles = [
    { name: 'user', description: 'Regular user with basic permissions', isDefault: true },
    { name: 'superuser', description: 'Super user with advanced permissions', isDefault: false },
    { name: 'Administrator', description: 'Administrator with elevated permissions', isDefault: false },
    { name: 'Super Administrator', description: 'Super administrator with all permissions', isDefault: false },
  ];

  for (const roleInfo of standardRoles) {
    const existingRole = await this.roleRepository.findOne({ where: { name: roleInfo.name } });
    if (!existingRole) {
      const newRole = this.roleRepository.create({
        name: roleInfo.name, isSystemRole: true,
        description: roleInfo.description, isDefault: roleInfo.isDefault,
      });
      const savedRole = await this.roleRepository.save(newRole);
      await this.assignDefaultPermissions(savedRole.id, roleInfo.name);
    }
  }
}

private async assignDefaultPermissions(roleId: number, roleName: string) {
  const permissionsService = await this.getPermissionsService();
  const permissionMappings = {
    user: ['self:profile:read', 'self:profile:update'],
    Administrator: ['users:create','users:view','users:update','users:delete','groups:create','groups:view','groups:update','groups:delete','groups:manage'],
    superuser: ['users:create','users:view','users:update','users:delete','users:manage','groups:create','groups:view','groups:update','groups:delete','groups:manage','roles:view','roles:create'],
    'Super Administrator': ['users:create','users:view','users:update','users:delete','users:admin','users:manage','users:emulate','groups:create','groups:view','groups:update','groups:delete','groups:admin','groups:manage','roles:create','roles:view','roles:update','roles:delete','roles:admin','roles:manage','roles:assign','permissions:view','permissions:update','permissions:admin','permissions:refresh','system:admin'],
  };
  const permissionStrings = permissionMappings[roleName] || [];
  for (const permString of permissionStrings) {
    const [resourceName, actionName] = permString.split(':');
    await permissionsService.ensurePermissionExists(resourceName, actionName);
  }
  try {
    await permissionsService.assignPermissionsToRole(roleId, permissionStrings);
  } catch (error) {
    console.error(`Error assigning permissions to role ${roleName}:`, error.message);
  }
}
```

#### 4 — Fix [create()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#55-83) signature

Replace the current [create(createRoleDto)](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#55-83) with one that accepts `currentUser`, enforces permission check, and applies `transformRoleForFrontend`:

```typescript
async create(createRoleDto: CreateRoleDto, currentUser: User): Promise<Role> {
  const hasPermission = await this.hasUserPermission(currentUser.id, 'roles', 'create');
  if (!hasPermission) throw new ForbiddenException('You do not have permission to create roles');

  const existingRole = await this.roleRepository.findOne({ where: { name: createRoleDto.name } });
  if (existingRole) throw new ForbiddenException(`Role with name ${createRoleDto.name} already exists`);

  const { permissionIds, ...roleData } = createRoleDto;
  const role = this.roleRepository.create({ ...roleData, isSystemRole: false });
  const savedRole = await this.roleRepository.save(role);

  if (permissionIds && permissionIds.length > 0) {
    await this.assignPermissionsToRole(savedRole.id, permissionIds);
  }

  const completeRole = await this.roleRepository.findOne({
    where: { id: savedRole.id },
    relations: ['rolePermissions', 'rolePermissions.permission'],
  });
  return completeRole ? this.transformRoleForFrontend(completeRole) : savedRole;
}
```

#### 5 — Fix [findAll()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#37-43) signature and return type

Replace the current no-pagination version:

```typescript
async findAll(
  page = 0, pageSize = 10, sortBy = 'name',
  sortDirection: 'ASC' | 'DESC' = 'ASC', search = '',
): Promise<{ items: Role[]; total: number; page: number; pageSize: number }> {
  const [items, total] = await this.roleRepository.findAndCount({
    where: search ? [{ name: ILike(`%${search}%`) }, { description: ILike(`%${search}%`) }] : {},
    relations: ['parent', 'children', 'rolePermissions', 'rolePermissions.permission'],
    order: { [sortBy]: sortDirection },
    skip: page * pageSize,
    take: pageSize,
  });
  return { items: items.map((r) => this.transformRoleForFrontend(r)), total, page, pageSize };
}
```

#### 6 — Fix [findOne()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-scope-templates.controller.ts#43-49) to apply transform

```typescript
async findOne(id: number): Promise<Role> {
  return this.transformRoleForFrontend(await this.findRoleById(id));
}
```

#### 7 — Fix [update()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.controller.ts#102-109) signature

Add `currentUser` parameter and permission check:

```typescript
async update(id: number, updateRoleDto: UpdateRoleDto, currentUser: User): Promise<Role> {
  const hasPermission = await this.hasUserPermission(currentUser.id, 'roles', 'update');
  if (!hasPermission) throw new ForbiddenException('You do not have permission to update roles');

  const role = await this.findRoleById(id);
  if (role.isSystemRole) throw new ForbiddenException('System-defined roles cannot be modified');

  if (updateRoleDto.name && updateRoleDto.name !== role.name) {
    const existingRole = await this.roleRepository.findOne({ where: { name: updateRoleDto.name } });
    if (existingRole) throw new ForbiddenException(`Role with name ${updateRoleDto.name} already exists`);
  }

  const { permissionIds, ...roleData } = updateRoleDto;
  this.roleRepository.merge(role, roleData);
  const updatedRole = await this.roleRepository.save(role);

  if (permissionIds) {
    await this.rolePermissionRepository.delete({ roleId: id });
    if (permissionIds.length > 0) await this.assignPermissionsToRole(id, permissionIds);
  }

  await this.clearPermissionCaches();
  return this.findOne(updatedRole.id);
}
```

#### 8 — Fix [remove()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#111-123) signature

Add `currentUser` parameter, permission check, and user-assignment guard:

```typescript
async remove(id: number, currentUser: User): Promise<void> {
  const hasPermission = await this.hasUserPermission(currentUser.id, 'roles', 'admin');
  if (!hasPermission) throw new ForbiddenException('You do not have permission to delete roles');

  const role = await this.findRoleById(id);
  if (role.isSystemRole) throw new ForbiddenException('System-defined roles cannot be deleted');

  const usersWithRole = await this.usersRepository.find({
    where: { roles: { id: role.id } }, take: 1,
  });
  if (usersWithRole.length > 0) throw new ForbiddenException('Cannot delete role that is assigned to users');

  await this.roleRepository.remove(role);
  await this.clearPermissionCaches();
}
```

#### 9 — Add `updateRolePermissions()`

```typescript
async updateRolePermissions(id: number, permissions: string[], currentUser: User): Promise<Role> {
  const hasPermission = await this.hasUserPermission(currentUser.id, 'roles', 'admin');
  if (!hasPermission) throw new ForbiddenException('You do not have permission to update role permissions');

  const role = await this.findOne(id);
  if (role.isSystemRole) throw new ForbiddenException('System-defined roles cannot be modified');

  const permissionsService = await this.getPermissionsService();
  try {
    await permissionsService.assignPermissionsToRole(id, permissions);
  } catch (error) {
    console.error(`Error updating role permissions:`, error.message);
    throw new BadRequestException(`Failed to update role permissions: ${error.message}`);
  }
  return role;
}
```

#### 10 — Add `assignRoleToUser()`

```typescript
async assignRoleToUser(userId: number, roleId: number, currentUser: User): Promise<User> {
  const hasPermission = await this.hasUserPermission(currentUser.id, 'roles', 'manage');
  if (!hasPermission) throw new ForbiddenException('You do not have permission to manage roles');

  const [user, role] = await Promise.all([
    this.usersRepository.findOne({ where: { id: userId }, relations: ['roles'] }),
    this.roleRepository.findOne({ where: { id: roleId } }),
  ]);
  if (!user) throw new NotFoundException(`User with ID ${userId} not found`);
  if (!role) throw new NotFoundException(`Role with ID ${roleId} not found`);

  const userHasSystemAdmin = await this.hasUserPermission(user.id, 'system', 'admin');
  const currentUserHasSystemAdmin = await this.hasUserPermission(currentUser.id, 'system', 'admin');
  if (userHasSystemAdmin && !currentUserHasSystemAdmin) {
    throw new ForbiddenException('Only system administrators can modify system administrator roles');
  }

  if (!user.roles) user.roles = [];
  if (!user.roles.some((r) => r.id === role.id)) user.roles.push(role);
  return this.usersRepository.save(user);
}
```

#### 11 — Add `findByName()` and `validateParentRemoval()`

```typescript
async findByName(name: string): Promise<Role> {
  const role = await this.roleRepository.findOne({ where: { name } });
  if (!role) throw new NotFoundException(`Role ${name} not found`);
  return role;
}

async validateParentRemoval(roleId: number): Promise<{ valid: boolean; affectedChildren: { id: number; name: string }[] }> {
  const children = await this.roleRepository.find({ where: { parentId: roleId } });
  const affectedChildren = children.map((c) => ({ id: c.id, name: c.name }));
  return { valid: true, affectedChildren };
}
```

#### 12 — Fix [clearPermissionCaches()](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#373-380)

Replace the empty-body stub with `reset()`:

```typescript
private async clearPermissionCaches(): Promise<void> {
  // RolesModule uses isolated CacheModule.register() — reset() clears only this module's store.
  await this.cacheManager.reset();
}
```

---

### [MODIFY] [roles.module.ts](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.module.ts)

Add [User](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/users/users.module.ts#16-33) to `forFeature` (already there ✅) and restore `ModuleRef` — wait, `ModuleRef` is a NestJS built-in injected automatically, no module change needed. Just re-add [User](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/users/users.module.ts#16-33) to `forFeature` if it was dropped, and confirm `forwardRef(() => PermissionsModule)` is still present. Current module file looks correct ✅ — no changes needed.

---

## Verification Plan

### Build
```bash
cd /home/eaxelrod/GitHub/frontend-templates/angular/backend && npm run build
```
Must compile with zero errors. Key checks: [create](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/permissions/controllers/rls-join-paths.controller.ts#55-83), [update](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.controller.ts#102-109), [remove](file:///home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/roles/roles.service.ts#111-123) signatures must match controller calls.

### Startup
```bash
npm run start:prod
```
Watch for `[RolesService] Ensuring system roles exist...` log (or equivalent). Verify no DI errors.

### Endpoint smoke tests
| Endpoint | Expected |
|---|---|
| `GET /api/roles?page=0&pageSize=10` | `{ items: [...], total: N, page: 0, pageSize: 10 }` |
| `POST /api/roles` | 201 with `permissions[]` array (not `rolePermissions`) |
| `PUT /api/roles/:id/permissions` | 200 |
| `PUT /api/roles/users/:userId/role` | 200 User object |
| `DELETE /api/roles/:id` | 200 (non-system role) |
