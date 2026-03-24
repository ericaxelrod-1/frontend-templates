import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RlsScopeTemplate } from '../entities/rls-scope-template.entity';
import {
  CreateRlsScopeTemplateDto,
  UpdateRlsScopeTemplateDto,
} from '../dto/rls-scope-template.dto';

@Controller('api/rls/scope-templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RlsScopeTemplatesController {
  constructor(
    @InjectRepository(RlsScopeTemplate)
    private readonly scopeTemplateRepository: Repository<RlsScopeTemplate>,
  ) {}

  @Get()
  @RequirePermission('rls_scope_templates:read')
  async findAll() {
    return this.scopeTemplateRepository.find({
      relations: ['joinPath'],
      order: { name: 'ASC' },
    });
  }

  @Get(':id')
  @RequirePermission('rls_scope_templates:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.scopeTemplateRepository.findOne({
      where: { id },
      relations: ['joinPath'],
    });
  }

  @Post()
  @RequirePermission('rls_scope_templates:manage')
  async create(@Body() createDto: CreateRlsScopeTemplateDto) {
    const template = this.scopeTemplateRepository.create({
      name: createDto.name,
      joinPathId: createDto.joinPathId,
      targetTable: createDto.targetTable,
      availableColumns: JSON.stringify(createDto.availableColumns),
    });

    return this.scopeTemplateRepository.save(template);
  }

  @Put(':id')
  @RequirePermission('rls_scope_templates:manage')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateRlsScopeTemplateDto,
  ) {
    const template = await this.scopeTemplateRepository.findOne({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Scope template not found');
    }

    if (updateDto.name !== undefined) template.name = updateDto.name;
    if (updateDto.joinPathId !== undefined)
      template.joinPathId = updateDto.joinPathId;
    if (updateDto.targetTable !== undefined)
      template.targetTable = updateDto.targetTable;
    if (updateDto.availableColumns !== undefined) {
      template.availableColumns = JSON.stringify(updateDto.availableColumns);
    }
    if (updateDto.description !== undefined) {
      template.description = updateDto.description;
    }
    if (updateDto.scopeSql !== undefined) {
      template.scopeSql = updateDto.scopeSql;
    }
    if (updateDto.parameters !== undefined) {
      template.parameters = JSON.stringify(updateDto.parameters);
    }

    return this.scopeTemplateRepository.save(template);
  }

  @Delete(':id')
  @RequirePermission('rls_scope_templates:manage')
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.scopeTemplateRepository.delete(id);
    return { success: true };
  }
}
