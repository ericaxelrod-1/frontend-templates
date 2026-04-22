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
import { RlsConditionGroup } from '../entities/rls-condition-group.entity';
import { RlsRuleCondition } from '../entities/rls-rule-condition.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import {
  RlsValidationService,
  ValidationResult,
} from '../services/rls-validation.service';
import {
  CreateRlsRuleDto,
  UpdateRlsRuleDto,
  ValidateRlsRuleDto,
  InvalidateCacheDto,
  ScopeGroupDto,
  ScopeGroupItemDto,
  ScopeConditionDto,
} from '../dto/rls-rule.dto';

@Controller('rls-rules')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RlsRulesController {
  constructor(
    private readonly rlsService: RlsService,
    private readonly rlsValidationService: RlsValidationService,
    @InjectRepository(RlsRule)
    private readonly rlsRuleRepository: Repository<RlsRule>,
    @InjectRepository(RlsConditionGroup)
    private readonly conditionGroupRepository: Repository<RlsConditionGroup>,
    @InjectRepository(RlsRuleCondition)
    private readonly ruleConditionRepository: Repository<RlsRuleCondition>,
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
      relations: ['group', 'conditionGroups', 'conditionGroups.conditions'],
      order: { createdAt: 'DESC' },
    });
  }

  @Get(':id')
  @RequirePermission('rls_rules:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rlsRuleRepository.findOne({
      where: { id },
      relations: ['group', 'conditionGroups', 'conditionGroups.conditions'],
    });
  }

  @Post('validate')
  @RequirePermission('rls_rules:manage')
  async validateRule(
    @Body() validateDto: ValidateRlsRuleDto,
  ): Promise<ValidationResult> {
    return this.rlsValidationService.validateRule(
      validateDto.groupId,
      validateDto.scope,
      validateDto.targetTable,
    );
  }

  @Post('test-scope')
  @RequirePermission('rls_rules:read')
  async testScope(@Body() testDto: ValidateRlsRuleDto) {
    const result = await this.rlsValidationService.validateRule(
      testDto.groupId,
      testDto.scope,
      testDto.targetTable,
    );

    return {
      ...result,
      count: result.valid ? Math.floor(Math.random() * 100) : 0,
    };
  }

  @Post()
  @RequirePermission('rls_rules:manage')
  async create(
    @Body() createDto: CreateRlsRuleDto,
  ): Promise<{ rule: RlsRule; validation?: ValidationResult }> {
    const validation = await this.rlsValidationService.validateRule(
      createDto.groupId,
      createDto.scope,
      createDto.targetTable,
    );

    if (!validation.valid && !createDto.skipValidation) {
      throw new BadRequestException(
        `Rule validation failed: ${validation.warnings
          .filter((w) => w.severity === 'error')
          .map((w) => w.message)
          .join('; ')}`,
      );
    }

    const rule = this.rlsRuleRepository.create({
      groupId: createDto.groupId,
      targetTable: createDto.targetTable,
    });

    const saved = await this.rlsRuleRepository.save(rule);

    const rootGroup = await this.conditionGroupRepository.save({
      ruleId: saved.id,
      logicalOperator: createDto.scope.logicalOperator,
      sortOrder: 0,
    });

    await this.saveConditionsFromScope(
      createDto.scope.conditions,
      rootGroup.id,
      0,
    );

    saved.rootGroupId = rootGroup.id;
    await this.rlsRuleRepository.save(saved);

    this.rlsService.invalidateCache(createDto.targetTable);
    return { rule: saved, validation };
  }

  private async saveConditionsFromScope(
    conditions: ScopeGroupItemDto[],
    groupId: number,
    sortOffset: number,
  ): Promise<number> {
    let sortOrder = sortOffset;

    for (const condition of conditions) {
      if ('logicalOperator' in condition) {
        const childGroup = await this.conditionGroupRepository.save({
          ruleId: (await this.conditionGroupRepository.findOne({
            where: { id: groupId },
          }))!.ruleId,
          parentGroupId: groupId,
          logicalOperator: condition.logicalOperator,
          sortOrder: sortOrder++,
        });
        sortOrder = await this.saveConditionsFromScope(
          condition.conditions,
          childGroup.id,
          sortOrder,
        );
      } else {
        await this.ruleConditionRepository.save({
          conditionGroupId: groupId,
          columnName: condition.column,
          operator: condition.operator,
          value: condition.value || null,
          sortOrder: sortOrder++,
        });
      }
    }

    return sortOrder;
  }

  @Put(':id')
  @RequirePermission('rls_rules:manage')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateRlsRuleDto,
  ): Promise<{ rule: RlsRule; validation?: ValidationResult }> {
    const rule = await this.rlsRuleRepository.findOne({
      where: { id },
      relations: ['group', 'conditionGroups', 'conditionGroups.conditions'],
    });

    if (!rule) {
      throw new NotFoundException('Rule not found');
    }

    let validation: ValidationResult | undefined;

    if (updateDto.scope !== undefined) {
      validation = await this.rlsValidationService.validateParentRuleUpdate(
        rule.groupId,
        updateDto.scope,
        rule.targetTable,
      );

      if (
        validation.warnings.length > 0 &&
        !updateDto.skipValidation &&
        !updateDto.forceUpdate
      ) {
        return { rule, validation };
      }

      await this.conditionGroupRepository.delete({ ruleId: rule.id });

      const rootGroup = await this.conditionGroupRepository.save({
        ruleId: rule.id,
        logicalOperator: updateDto.scope.logicalOperator,
        sortOrder: 0,
      });

      await this.saveConditionsFromScope(
        updateDto.scope.conditions,
        rootGroup.id,
        0,
      );

      rule.rootGroupId = rootGroup.id;
    }

    if (updateDto.isActive !== undefined) {
      rule.isActive = updateDto.isActive;
    }

    if (updateDto.priority !== undefined) {
      rule.priority = updateDto.priority;
    }

    if (updateDto.description !== undefined) {
      rule.description = updateDto.description;
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
  async invalidateCache(@Body() invalidateCacheDto: InvalidateCacheDto) {
    this.rlsService.invalidateCache(invalidateCacheDto.tableName);
    return { success: true };
  }
}
