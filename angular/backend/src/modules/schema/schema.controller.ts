import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { SchemaService, TableInfo, ColumnInfo } from './schema.service';

/**
 * Every handler here discloses the live database shape — table names, column
 * names and types, primary keys, foreign-key relations. That is a map of the
 * whole system for whoever asks, so these endpoints used to carry no guard at
 * all and answered anyone, token or not.
 *
 * A previous report classified this controller as dead code and a candidate for
 * deletion, on the grounds that `SchemaController` appears in no `*.module.ts`
 * outside its own. That is wrong, and the route was live the whole time:
 * `SchemaModule` is imported at app.module.ts:38 and registered at
 * app.module.ts:101, Nest instantiates the controllers of every imported module,
 * and four frontend callers depend on the response shape
 * (`rls.service.ts`, `join-path-diagram.component.ts`, `scope-builder.component.ts`,
 * `join-paths-admin.component.ts`). So the fix is a guard, not a deletion.
 *
 * The capability is `rls_rules:manage`, not an invented `schema:view`. Every
 * caller of these endpoints is an RLS-management admin screen, and
 * `rls_rules:manage` is granted in the seed to exactly the administrative roles
 * that use them (Administrator, Super Administrator, superuser) and to nobody
 * else. It is two-part, so the guard's `split(':')` in permission.guard.ts
 * reconstructs it faithfully — unlike the three-part group rows, which truncate.
 *
 * The guard sits on the class because all seven handlers share one requirement;
 * the requirement itself is on each handler, never on the class, because the
 * guard concatenates class and handler metadata and evaluates with OR
 * (permission.guard.ts:205-226) and would otherwise widen the set.
 */
@ApiTags('schema')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('schema')
export class SchemaController {
  constructor(private readonly schemaService: SchemaService) {}

  @RequirePermission('rls_rules:manage')
  @Get('tables')
  @ApiOperation({ summary: 'List all database tables' })
  @ApiResponse({
    status: 200,
    description: 'List of all tables with their columns',
  })
  async getAllTables(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ): Promise<{ items: TableInfo[]; total: number }> {
    return this.schemaService.getAllTables({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @RequirePermission('rls_rules:manage')
  @Get('tables/:table/columns')
  @ApiOperation({ summary: 'Get columns for a specific table' })
  @ApiResponse({
    status: 200,
    description: 'List of columns for the specified table',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'id' },
          type: { type: 'string', example: 'int' },
          isPrimary: { type: 'boolean' },
          isNullable: { type: 'boolean' },
          isGenerated: { type: 'boolean' },
          defaultValue: { type: 'any' },
          comment: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Table not found' })
  async getTableColumns(
    @Param('table') tableName: string,
  ): Promise<ColumnInfo[]> {
    const columns = await this.schemaService.getTableColumns(tableName);

    if (columns === null) {
      throw new NotFoundException(`Table '${tableName}' not found`);
    }

    return columns;
  }

  @RequirePermission('rls_rules:manage')
  @Get('tables/:table/metadata')
  @ApiOperation({ summary: 'Get full metadata for a specific table' })
  @ApiResponse({
    status: 200,
    description: 'Full metadata for the specified table',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        columns: { type: 'array' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Table not found' })
  async getTableMetadata(
    @Param('table') tableName: string,
  ): Promise<TableInfo> {
    const metadata = await this.schemaService.getTableMetadata(tableName);

    if (metadata === null) {
      throw new NotFoundException(`Table '${tableName}' not found`);
    }

    return metadata;
  }

  @RequirePermission('rls_rules:manage')
  @Get('tables/:table/primary-keys')
  @ApiOperation({ summary: 'Get primary key columns for a table' })
  @ApiResponse({
    status: 200,
    description: 'List of primary key column names',
    schema: {
      type: 'array',
      items: { type: 'string' },
    },
  })
  async getPrimaryKeys(@Param('table') tableName: string): Promise<string[]> {
    return this.schemaService.getPrimaryKeyColumns(tableName);
  }

  @RequirePermission('rls_rules:manage')
  @Get('tables/:table/relations')
  @ApiOperation({ summary: 'Get relation columns for a table' })
  @ApiResponse({
    status: 200,
    description: 'List of relation columns with target tables',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          targetTable: { type: 'string' },
        },
      },
    },
  })
  async getRelations(
    @Param('table') tableName: string,
  ): Promise<{ name: string; targetTable: string }[]> {
    return this.schemaService.getRelationColumns(tableName);
  }

  @RequirePermission('rls_rules:manage')
  @Get('tables/:table/references')
  @ApiOperation({ summary: 'Get tables referenced by a table' })
  @ApiResponse({
    status: 200,
    description: 'List of referenced tables and columns',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tableName: { type: 'string' },
          columnName: { type: 'string' },
        },
      },
    },
  })
  async getReferencedTables(
    @Param('table') tableName: string,
  ): Promise<{ tableName: string; columnName: string }[]> {
    return this.schemaService.getReferencedTables(tableName);
  }

  @RequirePermission('rls_rules:manage')
  @Get('tables/:table/referencing')
  @ApiOperation({ summary: 'Get tables that reference a table' })
  @ApiResponse({
    status: 200,
    description: 'List of referencing tables and columns',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tableName: { type: 'string' },
          columnName: { type: 'string' },
        },
      },
    },
  })
  async getReferencingTables(
    @Param('table') tableName: string,
  ): Promise<{ tableName: string; columnName: string }[]> {
    return this.schemaService.getReferencingTables(tableName);
  }
}
