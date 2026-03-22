import {
  Controller,
  Get,
  Param,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SchemaService, TableInfo, ColumnInfo } from './schema.service';

@ApiTags('schema')
@ApiBearerAuth()
@Controller('schema')
export class SchemaController {
  constructor(private readonly schemaService: SchemaService) {}

  @Get('tables')
  @ApiOperation({ summary: 'List all database tables' })
  @ApiResponse({
    status: 200,
    description: 'List of all tables with their columns',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'users' },
          columns: {
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
        },
      },
    },
  })
  async getAllTables(): Promise<TableInfo[]> {
    return this.schemaService.getAllTables();
  }

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
  async getTableMetadata(@Param('table') tableName: string): Promise<TableInfo> {
    const metadata = await this.schemaService.getTableMetadata(tableName);

    if (metadata === null) {
      throw new NotFoundException(`Table '${tableName}' not found`);
    }

    return metadata;
  }

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
