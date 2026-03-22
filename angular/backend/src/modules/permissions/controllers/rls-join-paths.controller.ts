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
import { RlsJoinPath } from '../entities/rls-join-path.entity';
import { RlsJoinCondition } from '../entities/rls-join-condition.entity';

@Controller('api/rls/join-paths')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RlsJoinPathsController {
  constructor(
    @InjectRepository(RlsJoinPath)
    private readonly joinPathRepository: Repository<RlsJoinPath>,
    @InjectRepository(RlsJoinCondition)
    private readonly joinConditionRepository: Repository<RlsJoinCondition>,
  ) {}

  @Get()
  @RequirePermission('rls_join_paths:read')
  async findAll() {
    return this.joinPathRepository.find({
      relations: ['conditions'],
      order: { name: 'ASC' },
    });
  }

  @Get(':id')
  @RequirePermission('rls_join_paths:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.joinPathRepository.findOne({
      where: { id },
      relations: ['conditions'],
    });
  }

  @Post()
  @RequirePermission('rls_join_paths:manage')
  async create(
    @Body()
    createDto: {
      name: string;
      targetTable: string;
      chain: string;
      conditions?: {
        fromTable: string;
        fromColumn: string;
        toTable: string;
        toColumn: string;
        operator?: string;
      }[];
    },
  ) {
    const joinPath = this.joinPathRepository.create({
      name: createDto.name,
      targetTable: createDto.targetTable,
      chain: createDto.chain,
    });

    const savedPath = await this.joinPathRepository.save(joinPath);

    if (createDto.conditions && createDto.conditions.length > 0) {
      const conditions = createDto.conditions.map((c) =>
        this.joinConditionRepository.create({
          joinPathId: savedPath.id,
          fromTable: c.fromTable,
          fromColumn: c.fromColumn,
          toTable: c.toTable,
          toColumn: c.toColumn,
          operator: c.operator || '=',
        }),
      );
      await this.joinConditionRepository.save(conditions);
    }

    return this.joinPathRepository.findOne({
      where: { id: savedPath.id },
      relations: ['conditions'],
    });
  }

  @Put(':id')
  @RequirePermission('rls_join_paths:manage')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    updateDto: {
      name?: string;
      targetTable?: string;
      chain?: string;
      conditions?: {
        fromTable: string;
        fromColumn: string;
        toTable: string;
        toColumn: string;
        operator?: string;
      }[];
    },
  ) {
    const joinPath = await this.joinPathRepository.findOne({ where: { id } });
    if (!joinPath) {
      throw new NotFoundException('Join path not found');
    }

    if (updateDto.name) joinPath.name = updateDto.name;
    if (updateDto.targetTable) joinPath.targetTable = updateDto.targetTable;
    if (updateDto.chain) joinPath.chain = updateDto.chain;

    await this.joinPathRepository.save(joinPath);

    if (updateDto.conditions) {
      await this.joinConditionRepository.delete({ joinPathId: id });
      if (updateDto.conditions.length > 0) {
        const conditions = updateDto.conditions.map((c) =>
          this.joinConditionRepository.create({
            joinPathId: id,
            fromTable: c.fromTable,
            fromColumn: c.fromColumn,
            toTable: c.toTable,
            toColumn: c.toColumn,
            operator: c.operator || '=',
          }),
        );
        await this.joinConditionRepository.save(conditions);
      }
    }

    return this.joinPathRepository.findOne({
      where: { id },
      relations: ['conditions'],
    });
  }

  @Delete(':id')
  @RequirePermission('rls_join_paths:manage')
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.joinPathRepository.delete(id);
    return { success: true };
  }
}
