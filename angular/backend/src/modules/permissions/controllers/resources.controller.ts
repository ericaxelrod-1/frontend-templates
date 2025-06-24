import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { PermissionsService } from '../services/permissions.service';
import { Resource } from '../entities/resource.entity';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';

// DTOs for resource management
class CreateResourceDto {
  name: string;
  description?: string;
}

class UpdateResourceDto {
  name?: string;
  description?: string;
}

// Add resource response DTO for consistency
class ResourceResponseDto {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

@ApiTags('resources')
@ApiBearerAuth()
@Controller('resources')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('permissions:access')
export class ResourcesController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermission('resources:view')
  @ApiOperation({ summary: 'Get all resources' })
  @ApiResponse({
    status: 200,
    description: 'Return all resources',
    type: [ResourceResponseDto],
  })
  async getAllResources(): Promise<Resource[]> {
    return this.permissionsService.getAllResources();
  }

  @Get(':id')
  @RequirePermission('resources:view')
  @ApiOperation({ summary: 'Get resource by ID' })
  @ApiParam({ name: 'id', description: 'Resource ID' })
  @ApiResponse({
    status: 200,
    description: 'Return the resource',
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getResourceById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Resource> {
    const resource = await this.permissionsService.getResourceById(id);
    if (!resource) {
      throw new NotFoundException(`Resource with ID ${id} not found`);
    }
    return resource;
  }

  @Post()
  @RequirePermission('resources:create')
  @ApiOperation({ summary: 'Create a new resource' })
  @ApiResponse({ status: 201, description: 'The resource has been created' })
  @ApiResponse({ status: 403, description: 'Resource already exists' })
  async createResource(
    @Body() createResourceDto: CreateResourceDto,
  ): Promise<Resource> {
    try {
      return await this.permissionsService.createResource(createResourceDto);
    } catch (error) {
      throw new NotFoundException(
        `Failed to create resource: ${error.message}`,
      );
    }
  }

  @Put(':id')
  @RequirePermission('resources:update')
  @ApiOperation({ summary: 'Update resource' })
  @ApiParam({ name: 'id', description: 'Resource ID' })
  @ApiResponse({ status: 200, description: 'The resource has been updated' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async updateResource(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateResourceDto: UpdateResourceDto,
  ): Promise<Resource> {
    try {
      const resource = await this.permissionsService.updateResource(
        id,
        updateResourceDto,
      );

      if (!resource) {
        throw new NotFoundException(`Resource with ID ${id} not found`);
      }

      return resource;
    } catch (error) {
      throw new NotFoundException(`Resource not found: ${error.message}`);
    }
  }

  @Delete(':id')
  @RequirePermission('resources:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a resource' })
  @ApiResponse({ status: 204, description: 'The resource has been deleted' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async deleteResource(@Param('id', ParseIntPipe) id: number): Promise<void> {
    try {
      await this.permissionsService.deleteResource(id);
    } catch (error) {
      throw new NotFoundException(`Resource not found: ${error.message}`);
    }
  }
}
