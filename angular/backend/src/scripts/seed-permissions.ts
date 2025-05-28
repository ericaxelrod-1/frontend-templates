#!/usr/bin/env node
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Logger } from '@nestjs/common';
import { getRepository } from 'typeorm';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Role } from '../modules/permissions/entities/role.entity';
import { Group } from '../modules/permissions/entities/group.entity';
import { RolePermission } from '../modules/permissions/entities/role-permission.entity';
import { GroupPermission } from '../modules/permissions/entities/group-permission.entity';

/**
 * Seed script for populating the permissions database with initial data
 */
async function bootstrap() {
  const logger = new Logger('PermissionSeeder');
  logger.log('Starting permission database seeding...');

  try {
    // Create a NestJS application context
    const app = await NestFactory.createApplicationContext(AppModule);

    // Get the repositories
    const permissionRepository = app.get('PermissionRepository');
    const roleRepository = app.get('RoleRepository');
    const groupRepository = app.get('GroupRepository');
    const rolePermissionRepository = app.get('RolePermissionRepository');
    const groupPermissionRepository = app.get('GroupPermissionRepository');

    logger.log('Repositories initialized. Starting seeding...');

    // Create standard permissions
    logger.log('Creating standard permissions...');

    // User management permissions
    const userPermissions = [
      createPermission('users', 'view', 'View user details'),
      createPermission('users', 'list', 'List all users'),
      createPermission('users', 'create', 'Create new users'),
      createPermission('users', 'update', 'Update user details'),
      createPermission('users', 'delete', 'Delete users'),
    ];

    // Role management permissions
    const rolePermissions = [
      createPermission('roles', 'view', 'View role details'),
      createPermission('roles', 'list', 'List all roles'),
      createPermission('roles', 'create', 'Create new roles'),
      createPermission('roles', 'update', 'Update role details'),
      createPermission('roles', 'delete', 'Delete roles'),
      createPermission('roles', 'assign', 'Assign roles to users'),
    ];

    // Group management permissions
    const groupPermissions = [
      createPermission('groups', 'view', 'View group details'),
      createPermission('groups', 'list', 'List all groups'),
      createPermission('groups', 'create', 'Create new groups'),
      createPermission('groups', 'update', 'Update group details'),
      createPermission('groups', 'delete', 'Delete groups'),
      createPermission('groups', 'assign', 'Assign users to groups'),
    ];

    try {
      // Save all permissions
      const savedUserPermissions =
        await permissionRepository.save(userPermissions);
      const savedRolePermissions =
        await permissionRepository.save(rolePermissions);
      const savedGroupPermissions =
        await permissionRepository.save(groupPermissions);

      logger.log('Permissions created successfully');

      // Create standard roles if they don't exist
      const adminRole = await roleRepository.findOne({
        where: { name: 'admin' },
      });
      const managerRole = await roleRepository.findOne({
        where: { name: 'manager' },
      });
      const userRole = await roleRepository.findOne({
        where: { name: 'user' },
      });

      // Create admin role if it doesn't exist
      const savedAdminRole =
        adminRole ||
        (await roleRepository.save({
          name: 'admin',
          description: 'Administrator role with full system access',
          isSystemRole: true,
        }));

      // Create manager role if it doesn't exist
      const savedManagerRole =
        managerRole ||
        (await roleRepository.save({
          name: 'manager',
          description: 'Manager role with elevated privileges',
          isSystemRole: true,
        }));

      // Create user role if it doesn't exist
      const savedUserRole =
        userRole ||
        (await roleRepository.save({
          name: 'user',
          description: 'Standard user role',
          isSystemRole: true,
        }));

      logger.log('Roles created successfully');

      // Create standard groups if they don't exist
      const adminGroup = await groupRepository.findOne({
        where: { name: 'Administrators' },
      });
      const managerGroup = await groupRepository.findOne({
        where: { name: 'Managers' },
      });
      const usersGroup = await groupRepository.findOne({
        where: { name: 'Users' },
      });

      // Create admin group if it doesn't exist
      const savedAdminGroup =
        adminGroup ||
        (await groupRepository.save({
          name: 'Administrators',
          description: 'System administrators group',
        }));

      // Create manager group if it doesn't exist
      const savedManagerGroup =
        managerGroup ||
        (await groupRepository.save({
          name: 'Managers',
          description: 'System managers group',
        }));

      // Create users group if it doesn't exist
      const savedUsersGroup =
        usersGroup ||
        (await groupRepository.save({
          name: 'Users',
          description: 'Standard users group',
        }));

      logger.log('Groups created successfully');

      // Assign permissions to roles
      // Admin role permissions
      const adminRolePermissionList = [
        ...savedUserPermissions,
        ...savedRolePermissions,
        ...savedGroupPermissions,
      ];
      const adminRolePermissions = adminRolePermissionList.map((permission) => {
        const rolePermission = new RolePermission();
        rolePermission.roleId = savedAdminRole.id;
        rolePermission.permissionId = permission.id;
        rolePermission.isGranted = true;
        rolePermission.role = savedAdminRole;
        rolePermission.permission = permission;
        return rolePermission;
      });

      // Manager role permissions
      const managerRolePermissionList = [
        ...savedUserPermissions.filter((p) => !p.name.includes('delete')),
        ...savedGroupPermissions.filter((p) => !p.name.includes('delete')),
      ];
      const managerRolePermissions = managerRolePermissionList.map(
        (permission) => {
          const rolePermission = new RolePermission();
          rolePermission.roleId = savedManagerRole.id;
          rolePermission.permissionId = permission.id;
          rolePermission.isGranted = true;
          rolePermission.role = savedManagerRole;
          rolePermission.permission = permission;
          return rolePermission;
        },
      );

      // User role permissions
      const userRolePermissionList = [
        savedUserPermissions[0], // users:view
      ];
      const userRolePermissions = userRolePermissionList.map((permission) => {
        const rolePermission = new RolePermission();
        rolePermission.roleId = savedUserRole.id;
        rolePermission.permissionId = permission.id;
        rolePermission.isGranted = true;
        rolePermission.role = savedUserRole;
        rolePermission.permission = permission;
        return rolePermission;
      });

      // Save all role permissions
      await rolePermissionRepository.save([
        ...adminRolePermissions,
        ...managerRolePermissions,
        ...userRolePermissions,
      ]);

      logger.log('Role permissions assigned successfully');

      // Assign permissions to groups
      // Admin group permissions
      const adminGroupPermissionList = [
        ...savedUserPermissions,
        ...savedRolePermissions,
        ...savedGroupPermissions,
      ];
      const adminGroupPermissions = adminGroupPermissionList.map(
        (permission) => {
          const groupPermission = new GroupPermission();
          groupPermission.groupId = savedAdminGroup.id;
          groupPermission.permissionId = permission.id;
          groupPermission.isGranted = true;
          groupPermission.group = savedAdminGroup;
          groupPermission.permission = permission;
          return groupPermission;
        },
      );

      // Manager group permissions
      const managerGroupPermissionList = [
        ...savedUserPermissions.filter((p) => !p.name.includes('delete')),
        ...savedGroupPermissions.filter((p) => !p.name.includes('delete')),
      ];
      const managerGroupPermissions = managerGroupPermissionList.map(
        (permission) => {
          const groupPermission = new GroupPermission();
          groupPermission.groupId = savedManagerGroup.id;
          groupPermission.permissionId = permission.id;
          groupPermission.isGranted = true;
          groupPermission.group = savedManagerGroup;
          groupPermission.permission = permission;
          return groupPermission;
        },
      );

      // User group permissions
      const userGroupPermissionList = [
        savedUserPermissions[0], // users:view
      ];
      const userGroupPermissions = userGroupPermissionList.map((permission) => {
        const groupPermission = new GroupPermission();
        groupPermission.groupId = savedUsersGroup.id;
        groupPermission.permissionId = permission.id;
        groupPermission.isGranted = true;
        groupPermission.group = savedUsersGroup;
        groupPermission.permission = permission;
        return groupPermission;
      });

      // Save all group permissions
      await groupPermissionRepository.save([
        ...adminGroupPermissions,
        ...managerGroupPermissions,
        ...userGroupPermissions,
      ]);

      logger.log('Group permissions assigned successfully');
    } catch (error) {
      logger.warn(`Error saving groups: ${error.message}`);
    }

    logger.log('Seeding completed successfully!');

    // Close the application context
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error during permission seeding:', error.stack);
    process.exit(1);
  }
}

/**
 * Helper function to create permission objects
 */
function createPermission(
  resource: string,
  action: string,
  description: string,
): Permission {
  const permission = new Permission();
  permission.resourceName = resource;
  permission.name = `${resource}:${action}`;
  permission.description = description;
  // Note: actionId should be set based on Action entity lookup, not actionName
  return permission;
}

bootstrap();
