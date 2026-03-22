import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('roles')
@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({
    status: 201,
    description: 'The role has been created successfully.',
    type: Role,
  })
  create(@Body() createRoleDto: CreateRoleDto): Promise<Role> {
    return this.rolesService.create(createRoleDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ status: 200, description: 'List of all roles', type: [Role] })
  findAll(): Promise<Role[]> {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'The found role', type: Role })
  @ApiResponse({ status: 404, description: 'Role not found' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Role> {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a role' })
  @ApiResponse({
    status: 200,
    description: 'The role has been updated successfully.',
    type: Role,
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
  ): Promise<Role> {
    return this.rolesService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a role' })
  @ApiResponse({
    status: 200,
    description: 'The role has been deleted successfully.',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.rolesService.remove(id);
  }

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Get all permissions for a role' })
  @ApiResponse({
    status: 200,
    description: 'List of role permissions',
    type: [Permission],
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  getRolePermissions(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Permission[]> {
    return this.rolesService.getRolePermissions(id);
  }

  @Get(':id/effective-permissions')
  @ApiOperation({ summary: 'Get effective permissions including inherited' })
  @ApiResponse({
    status: 200,
    description: 'List of effective permissions',
    type: [Permission],
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  getEffectivePermissions(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ permission: string; isGranted: boolean; source: string }[]> {
    return this.rolesService.getEffectivePermissions(id);
  }

  @Get(':id/ancestors')
  @ApiOperation({ summary: 'Get all ancestor roles' })
  @ApiResponse({
    status: 200,
    description: 'List of ancestor roles',
    type: [Role],
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  getAncestors(@Param('id', ParseIntPipe) id: number): Promise<Role[]> {
    return this.rolesService.getAncestors(id);
  }

  @Get(':id/descendants')
  @ApiOperation({ summary: 'Get all descendant roles' })
  @ApiResponse({
    status: 200,
    description: 'List of descendant roles',
    type: [Role],
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  getDescendants(@Param('id', ParseIntPipe) id: number): Promise<Role[]> {
    return this.rolesService.getDescendants(id);
  }
}
