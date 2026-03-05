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
import { Permission } from './entities/permission.entity';

// DTOs for action management
class CreateActionDto {
  name: string;
  description?: string;
}

class UpdateActionDto {
  name?: string;
  description?: string;
}

@ApiTags('actions')
@Controller('actions')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('permissions:access')
export class ActionsController {
  constructor(private readonly permissionsService: PermissionsService) { }

  @Get()
  @RequirePermission('actions:view')
  @ApiOperation({ summary: 'Get all unique actions' })
  @ApiResponse({ status: 200, description: 'Return all actions' })
  async getAllActions() {
    // Get all permissions and extract unique actions
    const permissions = await this.permissionsService.findAll();
    const uniqueActions = [...new Set(permissions.map((p) => p.actionEntity?.actionCode || ''))];

    // Convert to legacy format for backward compatibility
    return uniqueActions.map((name) => ({
      id: name,
      name,
      description: `Action: ${name}`,
    }));
  }

  @Get(':id')
  @RequirePermission('actions:view')
  @ApiOperation({ summary: 'Get action by ID' })
  @ApiResponse({ status: 200, description: 'Return the action' })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async getActionById(@Param('id') id: string) {
    // Get all permissions and find those with matching actionName
    const permissions = await this.permissionsService.findAll();
    const matchingPermissions = permissions.filter((p) => (p.actionEntity?.actionCode || '') === id);

    if (matchingPermissions.length === 0) {
      throw new NotFoundException(`Action with ID ${id} not found`);
    }

    // Return in legacy format for backward compatibility
    return {
      id,
      name: id,
      description: `Action: ${id}`,
    };
  }

  @Post()
  @RequirePermission('actions:create')
  @ApiOperation({ summary: 'Create a new action' })
  @ApiResponse({ status: 201, description: 'The action has been created' })
  @ApiResponse({ status: 403, description: 'Action already exists' })
  async createAction(@Body() createActionDto: CreateActionDto) {
    // Create a dummy permission to establish this action
    const dummyPermission = await this.permissionsService.create({
      resourceName: 'system',
      name: `system:${createActionDto.name}`,
      description:
        createActionDto.description || `Action: ${createActionDto.name}`,
    });

    // Return in legacy format
    return {
      id: createActionDto.name,
      name: createActionDto.name,
      description:
        createActionDto.description || `Action: ${createActionDto.name}`,
    };
  }

  @Put(':id')
  @RequirePermission('actions:update')
  @ApiOperation({ summary: 'Update an action' })
  @ApiResponse({ status: 200, description: 'The action has been updated' })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async updateAction(
    @Param('id') id: string,
    @Body() updateActionDto: UpdateActionDto,
  ) {
    // Get all permissions with this action
    const permissions = await this.permissionsService.findAll();
    const matchingPermissions = permissions.filter((p) => (p.actionEntity?.actionCode || '') === id);

    if (matchingPermissions.length === 0) {
      throw new NotFoundException(`Action with ID ${id} not found`);
    }

    // We don't really update actions directly in the new model
    // Just return the updated format
    return {
      id,
      name: updateActionDto.name || id,
      description: updateActionDto.description || `Action: ${id}`,
    };
  }

  @Delete(':id')
  @RequirePermission('actions:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an action' })
  @ApiResponse({ status: 204, description: 'The action has been deleted' })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async deleteAction(@Param('id') id: string) {
    // Get all permissions with this action
    const permissions = await this.permissionsService.findAll();
    const matchingPermissions = permissions.filter((p) => (p.actionEntity?.actionCode || '') === id);

    if (matchingPermissions.length === 0) {
      throw new NotFoundException(`Action with ID ${id} not found`);
    }

    // Delete all permissions with this action
    for (const permission of matchingPermissions) {
      await this.permissionsService.delete(permission.id);
    }
  }
}
