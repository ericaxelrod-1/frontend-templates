import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { PermissionsService } from './services/permissions.service';
import { Permission } from './entities/permission.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermission } from './decorators/require-permission.decorator';

@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermission('permissions:view')
  async findAll(): Promise<Permission[]> {
    return this.permissionsService.findAll();
  }

  @Get(':id')
  @RequirePermission('permissions:view')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<Permission> {
    return this.permissionsService.findOne(id);
  }

  @Get('role/:roleId')
  @RequirePermission('permissions:view')
  async findByRole(
    @Param('roleId', ParseIntPipe) roleId: number,
  ): Promise<Permission[]> {
    return this.permissionsService.findByRole(roleId);
  }

  @Get('group/:groupId')
  @RequirePermission('permissions:view')
  async findByGroup(
    @Param('groupId', ParseIntPipe) groupId: number,
  ): Promise<Permission[]> {
    return this.permissionsService.findByGroup(groupId);
  }

  @Post()
  @RequirePermission('permissions:create')
  async create(
    @Body() createPermissionDto: Partial<Permission>,
  ): Promise<Permission> {
    return this.permissionsService.create(createPermissionDto);
  }

  @Put(':id')
  @RequirePermission('permissions:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePermissionDto: Partial<Permission>,
  ): Promise<Permission> {
    return this.permissionsService.update(id, updatePermissionDto);
  }

  @Delete(':id')
  @RequirePermission('permissions:delete')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.permissionsService.delete(id);
  }
}
