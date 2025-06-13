import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { PermissionsService } from './services/permissions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermission } from './decorators/require-permission.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

// DTOs for resource management
export class CreateResourceDto {
  name: string;
  description?: string;
}

export class UpdateResourceDto {
  name?: string;
  description?: string;
}

@ApiTags('resources')
@Controller('resources')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('permissions:access')
export class ResourcesController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermission('resources:view')
  @ApiOperation({ summary: 'Get all resources' })
  @ApiResponse({ status: 200, description: 'Return all resources' })
  async getAllResources(): Promise<string[]> {
    return this.permissionsService.findAllResources();
  }

  @Post()
  @RequirePermission('resources:create')
  @ApiOperation({ summary: 'Create a new resource' })
  @ApiResponse({ status: 201, description: 'The resource has been created' })
  @ApiResponse({ status: 403, description: 'Resource already exists' })
  async createResource(@Body() createResourceDto: CreateResourceDto) {
    return this.permissionsService.createResource(createResourceDto);
  }

  @Put(':name')
  @RequirePermission('resources:update')
  @ApiOperation({ summary: 'Update resource' })
  @ApiResponse({ status: 200, description: 'The resource has been updated' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async updateResource(
    @Param('name') name: string,
    @Body() updateResourceDto: UpdateResourceDto,
  ): Promise<any> {
    // Find all permissions with this resource name and update them
    const permissions = await this.permissionsService.findByResource(name);
    if (!permissions.length) {
      throw new NotFoundException(`Resource ${name} not found`);
    }

    // Update each permission's resource name if provided
    if (updateResourceDto.name) {
      for (const permission of permissions) {
        await this.permissionsService.update(permission.id, {
          resourceName: updateResourceDto.name,
        });
      }
    }

    return { message: 'Resource updated successfully' };
  }

  @Delete(':name')
  @RequirePermission('resources:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a resource' })
  @ApiResponse({ status: 204, description: 'The resource has been deleted' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async deleteResource(@Param('name') name: string) {
    // Find all permissions with this resource name
    const permissions = await this.permissionsService.findByResource(name);
    if (!permissions.length) {
      throw new NotFoundException(`Resource ${name} not found`);
    }

    // Delete all permissions with this resource name
    for (const permission of permissions) {
      await this.permissionsService.delete(permission.id);
    }
  }
}
