import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { RlsService } from '@our-org/nestjs-typeorm-rls';
import { RlsRule } from '../entities/rls-rule.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('api/rls-rules')
@UseGuards(JwtAuthGuard)
export class RlsRulesController {
  constructor(
    private readonly rlsService: RlsService,
    @InjectRepository(RlsRule)
    private readonly rlsRuleRepository: Repository<RlsRule>,
  ) {}

  @Get()
  async findAll(
    @Query('groupId') groupId?: string,
    @Query('targetTable') targetTable?: string,
  ) {
    const where: any = {};
    if (groupId) {
      where.groupId = parseInt(groupId, 10);
    }
    if (targetTable) {
      where.targetTable = targetTable;
    }

    return this.rlsRuleRepository.find({
      where,
      relations: ['group'],
      order: { createdAt: 'DESC' },
    });
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rlsRuleRepository.findOne({
      where: { id },
      relations: ['group'],
    });
  }

  @Post()
  async create(
    @Body() createDto: { groupId: number; targetTable: string; sql: string; parameters?: Record<string, any> },
  ) {
    const rule = this.rlsRuleRepository.create({
      groupId: createDto.groupId,
      targetTable: createDto.targetTable,
      sql: createDto.sql,
      parameters: createDto.parameters ? JSON.stringify(createDto.parameters) : null,
    });

    const saved = await this.rlsRuleRepository.save(rule);
    this.rlsService.invalidateCache(createDto.targetTable);
    return saved;
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: { sql?: string; parameters?: Record<string, any> },
  ) {
    const rule = await this.rlsRuleRepository.findOne({ where: { id } });
    if (!rule) {
      throw new Error('Rule not found');
    }

    if (updateDto.sql !== undefined) {
      rule.sql = updateDto.sql;
    }
    if (updateDto.parameters !== undefined) {
      rule.parameters = JSON.stringify(updateDto.parameters);
    }

    const updated = await this.rlsRuleRepository.save(rule);
    this.rlsService.invalidateCache(rule.targetTable);
    return updated;
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number) {
    const rule = await this.rlsRuleRepository.findOne({ where: { id } });
    if (rule) {
      const targetTable = rule.targetTable;
      await this.rlsRuleRepository.remove(rule);
      this.rlsService.invalidateCache(targetTable);
    }
    return { success: true };
  }

  @Post('invalidate-cache')
  async invalidateCache(@Body() body: { tableName?: string }) {
    this.rlsService.invalidateCache(body.tableName);
    return { success: true };
  }
}
