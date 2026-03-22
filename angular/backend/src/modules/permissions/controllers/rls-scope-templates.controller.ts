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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RlsScopeTemplate } from '../entities/rls-scope-template.entity';

@Controller('api/rls/scope-templates')
@UseGuards(JwtAuthGuard)
export class RlsScopeTemplatesController {
  constructor(
    @InjectRepository(RlsScopeTemplate)
    private readonly scopeTemplateRepository: Repository<RlsScopeTemplate>,
  ) {}

  @Get()
  async findAll() {
    return this.scopeTemplateRepository.find({
      relations: ['joinPath'],
      order: { name: 'ASC' },
    });
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.scopeTemplateRepository.findOne({
      where: { id },
      relations: ['joinPath'],
    });
  }

  @Post()
  async create(
    @Body()
    createDto: {
      name: string;
      joinPathId: number;
      targetTable: string;
      availableColumns: string[];
    },
  ) {
    const template = this.scopeTemplateRepository.create({
      name: createDto.name,
      joinPathId: createDto.joinPathId,
      targetTable: createDto.targetTable,
      availableColumns: JSON.stringify(createDto.availableColumns),
    });

    return this.scopeTemplateRepository.save(template);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    updateDto: {
      name?: string;
      joinPathId?: number;
      targetTable?: string;
      availableColumns?: string[];
    },
  ) {
    const template = await this.scopeTemplateRepository.findOne({
      where: { id },
    });
    if (!template) {
      throw new Error('Scope template not found');
    }

    if (updateDto.name !== undefined) template.name = updateDto.name;
    if (updateDto.joinPathId !== undefined)
      template.joinPathId = updateDto.joinPathId;
    if (updateDto.targetTable !== undefined)
      template.targetTable = updateDto.targetTable;
    if (updateDto.availableColumns !== undefined) {
      template.availableColumns = JSON.stringify(updateDto.availableColumns);
    }

    return this.scopeTemplateRepository.save(template);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.scopeTemplateRepository.delete(id);
    return { success: true };
  }
}
