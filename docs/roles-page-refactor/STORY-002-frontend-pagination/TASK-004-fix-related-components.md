# TASK-004: Fix Related Components

## Objective
Identify and resolve any compilation or TypeScript errors introduced in other components due to changing the `RoleService.getRoles` return type from `Observable<Role[]>` to `Observable<ServerResponse<Role>>`.

## Current State
`UsersComponent` and `CreateUserComponent` currently expect `RoleService.getRoles()` to return a direct array of roles (`Role[]`).

## Desired State
Components utilizing `RoleService` correctly handle the generic paginated data structure, accessing `response.items` for array populations.

## Steps
1. In `UsersComponent`, update `forkJoin` assignments linking to `data.roles`:
   ```typescript
   this.availableRoles = data.roles.items;
   ```
2. In `CreateUserComponent.loadRoles`, update the subscribe block:
   ```typescript
   this.roleService.getRoles().subscribe({
      next: (response) => {
         this.availableRoles = response.items;
      }
   });
   ```
3. Update `RoleSelectorSidebarComponent` similarly, handling `response.items` inside its internal `loadRoles()` method. 
