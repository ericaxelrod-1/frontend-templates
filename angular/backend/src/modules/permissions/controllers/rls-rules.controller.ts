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
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { RlsService } from '@our-org/nestjs-typeorm-rls';
import { RlsRule } from '../entities/rls-rule.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { RlsValidationService, ValidationResult } from '../services/rls-validation.service';

@Controller('api/rls-rules')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RlsRulesController {
  constructor(
    private readonly rlsService: RlsService,
    private readonly rlsValidationService: RlsValidationService,
    @InjectRepository(RlsRule)
    private readonly rlsRuleRepository: Repository<RlsRule>,
  ) {}

  @Get()
  @RequirePermission('rls_rules:read')
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
  @RequirePermission('rls_rules:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rlsRuleRepository.findOne({
      where: { id },
      relations: ['group'],
    });
  }

  @Post('validate')
  @RequirePermission('rls_rules:manage')
  async validateRule(
    @Body()
    validateDto: {
      groupId: number;
      targetTable: string;
      sql: string;
    },
  ): Promise<ValidationResult> {
    return this.rlsValidationService.validateRule(
      validateDto.groupId,
      validateDto.sql,
      validateDto.targetTable,
    );
  }

  @Post()
  @RequirePermission('rls_rules:manage')
  async create(
    @Body()
    createDto: {
      groupId: number;
      targetTable: string;
      sql: string;
      parameters?: Record<string, any>;
      skipValidation?: boolean;
    },
  ): Promise<{ rule: RlsRule; validation?: ValidationResult }> {
    const validation = await this.rlsValidationService.validateRule(
      createDto.groupId,
      createDto.sql,
      createDto.targetTable,
    );

    if (!validation.valid && !createDto.skipValidation) {
      throw new BadRequestException(
        `Rule validation failed: ${validation.warnings
          .filter(w => w.severity === 'error')
          .map(w => w.message)
          .join('; ')}`,
      );
    }

    const rule = this.rlsRuleRepository.create({
      groupId: createDto.groupId,
      targetTable: createDto.targetTable,
      sql: createDto.sql,
      parameters: createDto.parameters
        ? JSON.stringify(createDto.parameters)
        : null,
    });

    const saved = await this.rlsRuleRepository.save(rule);
    this.rlsService.invalidateCache(createDto.targetTable);
    return { rule: saved, validation };
  }

  @Put(':id')
  @RequirePermission('rls_rules:manage')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    updateDto: {
      sql?: string;
      parameters?: Record<string, any>;
      skipValidation?: boolean;
      forceUpdate?: boolean;
    },
  ): Promise<{ rule: RlsRule; validation?: ValidationResult }> {
    const rule = await this.rlsRuleRepository.findOne({
      where: { id },
      relations: ['group'],
    });

    if (!rule) {
      throw new NotFoundException('Rule not found');
    }

    let validation: ValidationResult | undefined;

    if (updateDto.sql !== undefined) {
      validation = await this.rlsValidationService.validateParentRuleUpdate(
        rule.groupId,
        updateDto.sql,
        rule.targetTable,
      );

      if (
        validation.warnings.length > 0 &&
        !updateDto.skipValidation &&
        !updateDto.forceUpdate
      ) {
        return { rule, validation };
      }

      rule.sql = updateDto.sql;
    }

    if (updateDto.parameters !== undefined) {
      rule.parameters = JSON.stringify(updateDto.parameters);
    }

    const updated = await this.rlsRuleRepository.save(rule);
    this.rlsService.invalidateCache(rule.targetTable);
    return { rule: updated, validation };
  }

  @Delete(':id')
  @RequirePermission('rls_rules:manage')
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
  @RequirePermission('rls_rules:manage')
  async invalidateCache(@Body() body: { tableName?: string }) {
    this.rlsService.invalidateCache(body.tableName);
    return { success: true };
  }
}
