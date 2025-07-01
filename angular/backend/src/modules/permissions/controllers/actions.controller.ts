import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CreateActionDto, UpdateActionDto } from '../dtos';
import { PermissionsService } from '../services/permissions.service';
import { Action } from '../entities/action.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../permission.decorator';
import { PermissionGuard } from '../permission.guard';

@ApiTags('actions')
@Controller('actions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ActionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @RequirePermission('actions:create')
  @ApiOperation({ summary: 'Create a new action' })
  @ApiResponse({
    status: 201,
    description: 'The action has been successfully created.',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  async create(@Body() createActionDto: CreateActionDto): Promise<Action> {
    return this.permissionsService.createAction(createActionDto);
  }

  @Get()
  @RequirePermission('actions:view')
  @ApiOperation({ summary: 'Get all actions' })
  @ApiResponse({ status: 200, description: 'Return all actions.' })
  async findAll(@Query('search') search?: string): Promise<Action[]> {
    return this.permissionsService.findAllActions(search);
  }

  @Get(':id')
  @RequirePermission('actions:view')
  @ApiOperation({ summary: 'Get a specific action by ID' })
  @ApiResponse({ status: 200, description: 'Return the action.' })
  @ApiResponse({ status: 404, description: 'Action not found.' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<Action> {
    return this.permissionsService.findActionById(id);
  }

  @Put(':id')
  @RequirePermission('actions:update')
  @ApiOperation({ summary: 'Update an action' })
  @ApiResponse({
    status: 200,
    description: 'The action has been successfully updated.',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  @ApiResponse({ status: 404, description: 'Action not found.' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateActionDto: UpdateActionDto,
  ): Promise<Action> {
    return this.permissionsService.updateAction(id, updateActionDto);
  }

  @Delete(':id')
  @RequirePermission('actions:delete')
  @ApiOperation({ summary: 'Delete an action' })
  @ApiResponse({
    status: 200,
    description: 'The action has been successfully deleted.',
  })
  @ApiResponse({ status: 404, description: 'Action not found.' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.permissionsService.removeAction(id);
  }
}
