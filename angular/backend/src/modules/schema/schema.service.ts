import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityMetadata } from 'typeorm';

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable: boolean;
  isGenerated: boolean;
  defaultValue: any;
  comment?: string;
}

@Injectable()
export class SchemaService {
  private readonly logger = new Logger(SchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getAllTables(): Promise<TableInfo[]> {
    const entities = this.dataSource.entityMetadatas;
    const tables: TableInfo[] = [];

    for (const entity of entities) {
      tables.push({
        name: entity.tableName,
        columns: this.extractColumns(entity),
      });
    }

    return tables.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTableColumns(tableName: string): Promise<ColumnInfo[] | null> {
    const entity = this.dataSource.entityMetadatas.find(
      (e) => e.tableName === tableName,
    );

    if (!entity) {
      return null;
    }

    return this.extractColumns(entity);
  }

  async getTableMetadata(tableName: string): Promise<TableInfo | null> {
    const entity = this.dataSource.entityMetadatas.find(
      (e) => e.tableName === tableName,
    );

    if (!entity) {
      return null;
    }

    return {
      name: entity.tableName,
      columns: this.extractColumns(entity),
    };
  }

  async getPrimaryKeyColumns(tableName: string): Promise<string[]> {
    const entity = this.dataSource.entityMetadatas.find(
      (e) => e.tableName === tableName,
    );

    if (!entity) {
      return [];
    }

    return entity.primaryColumns.map((col) => col.propertyName);
  }

  async getRelationColumns(
    tableName: string,
  ): Promise<{ name: string; targetTable: string }[]> {
    const entity = this.dataSource.entityMetadatas.find(
      (e) => e.tableName === tableName,
    );

    if (!entity) {
      return [];
    }

    return entity.relations.map((rel) => ({
      name: rel.propertyName,
      targetTable: rel.type instanceof Function ? rel.type.name : String(rel.type),
    }));
  }

  private extractColumns(entity: EntityMetadata): ColumnInfo[] {
    return entity.columns.map((column) => ({
      name: column.propertyName,
      type: this.mapColumnType(column.type),
      isPrimary: column.isPrimary,
      isNullable: column.isNullable,
      isGenerated: column.isGenerated,
      defaultValue: column.default,
      comment: column.comment,
    }));
  }

  private mapColumnType(type: any): string {
    if (typeof type === 'string') {
      return type;
    }
    if (type instanceof Function) {
      return type.name;
    }
    return String(type);
  }

  async tableExists(tableName: string): Promise<boolean> {
    const entity = this.dataSource.entityMetadatas.find(
      (e) => e.tableName === tableName,
    );
    return !!entity;
  }

  async getReferencedTables(
    tableName: string,
  ): Promise<{ tableName: string; columnName: string }[]> {
    const entity = this.dataSource.entityMetadatas.find(
      (e) => e.tableName === tableName,
    );

    if (!entity) {
      return [];
    }

    const references: { tableName: string; columnName: string }[] = [];

    for (const relation of entity.relations) {
      if (relation.joinColumns) {
        for (const joinCol of relation.joinColumns) {
          if (joinCol.referencedColumn && joinCol.referencedColumn.entityMetadata) {
            references.push({
              tableName: joinCol.referencedColumn.entityMetadata.tableName,
              columnName: joinCol.referencedColumn.propertyName,
            });
          }
        }
      }
    }

    return references;
  }

  async getReferencingTables(
    tableName: string,
  ): Promise<{ tableName: string; columnName: string }[]> {
    const entity = this.dataSource.entityMetadatas.find(
      (e) => e.tableName === tableName,
    );

    if (!entity) {
      return [];
    }

    const references: { tableName: string; columnName: string }[] = [];

    for (const relation of entity.relations) {
      if (relation.inverseJoinColumns) {
        continue;
      }
      references.push({
        tableName: relation.entityMetadata.tableName,
        columnName: relation.propertyName,
      });
    }

    return references;
  }
}
