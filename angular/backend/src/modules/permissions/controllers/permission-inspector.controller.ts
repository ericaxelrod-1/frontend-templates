import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UsersService } from '../../users/users.service';
import { RolesService } from '../../roles/roles.service';
import { GroupsService } from '../../users/groups.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolePermission } from '../entities/role-permission.entity';
import { GroupPermission } from '../entities/group-permission.entity';

@Controller('permissions-inspector')
@UseGuards(JwtAuthGuard)
export class PermissionInspectorController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly groupsService: GroupsService,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepository: Repository<GroupPermission>,
  ) {}

  @Get('user/:id')
  async inspectUser(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findOne(id);

    const rolePermissions = await this.rolePermissionRepository.find({
      where: { roleId: id },
      relations: ['permission', 'role'],
    });

    const groupPermissions = await this.groupPermissionRepository.find({
      where: { groupId: id },
      relations: ['permission', 'group'],
    });

    const effectivePermissions = await this.getEffectivePermissionsForRoles(
      user.roles?.map((r) => r.id) || [],
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      directRoles: user.roles?.map((r) => ({
        id: r.id,
        name: r.name,
      })),
      directGroups: user.groups?.map((g) => ({
        id: g.id,
        name: g.name,
      })),
      directPermissions: rolePermissions.map((rp) => ({
        permission: rp.permission?.name,
        isGranted: rp.isGranted,
        source: `Role: ${rp.role?.name}`,
      })),
      effectivePermissions,
    };
  }

  @Get('role/:id')
  async inspectRole(@Param('id', ParseIntPipe) id: number) {
    const role = await this.rolesService.findOne(id);
    const ancestors = await this.rolesService.getAncestors(id);
    const descendants = await this.rolesService.getDescendants(id);
    const effectivePermissions =
      await this.rolesService.getEffectivePermissions(id);

    return {
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystemRole: role.isSystemRole,
      },
      hierarchy: {
        ancestors: ancestors.map((r) => ({ id: r.id, name: r.name })),
        descendants: descendants.map((r) => ({ id: r.id, name: r.name })),
      },
      directPermissions: role.rolePermissions?.map((rp) => ({
        permission: rp.permission?.name,
        isGranted: rp.isGranted,
      })),
      effectivePermissions,
    };
  }

  @Get('group/:id')
  async inspectGroup(@Param('id', ParseIntPipe) id: number) {
    const group = await this.groupsService.findOne(id);
    const ancestors = await this.groupsService.getAncestors(id);
    const descendants = await this.groupsService.getDescendants(id);
    const effectiveMembers = await this.groupsService.getEffectiveMembers(id);

    return {
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        isSystemGroup: group.isSystemGroup,
      },
      hierarchy: {
        ancestors: ancestors.map((g) => ({ id: g.id, name: g.name })),
        descendants: descendants.map((g) => ({ id: g.id, name: g.name })),
      },
      directMembers: group.users?.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
      })),
      effectiveMemberCount: effectiveMembers.length,
    };
  }

  private async getEffectivePermissionsForRoles(roleIds: number[]) {
    const allPermissions: Map<string, { isGranted: boolean; source: string }> =
      new Map();

    for (const roleId of roleIds) {
      const effective = await this.rolesService.getEffectivePermissions(roleId);
      for (const perm of effective) {
        if (!allPermissions.has(perm.permission)) {
          allPermissions.set(perm.permission, {
            isGranted: perm.isGranted ?? false,
            source: perm.source,
          });
        }
      }
    }

    return Array.from(allPermissions.entries()).map(([permission, value]) => ({
      permission,
      isGranted: value.isGranted,
      inheritedFrom: value.source,
    }));
  }
}
