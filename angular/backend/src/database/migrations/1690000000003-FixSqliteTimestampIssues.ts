import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixSqliteTimestampIssues1690000000003
  implements MigrationInterface
{
  name = 'FixSqliteTimestampIssues1690000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated.
    // Its primary goal of converting TIMESTAMP columns to datetime is unlikely to be effective 
    // due to how SQLite reports column types from PRAGMA table_info.
    // The revised 1658012345678-CreatePermissionEntities.ts migration will establish correct datetime types.
    // The temporary table DDL in this migration also assumes VARCHAR PKs for tables that will be changed to INTEGER PKs,
    // which could cause issues if this migration's conditions were met after other refactoring.
    // The creation of 'cache_sync_status' is redundantly handled by the preceding migration 1690000000002.
    // Making this a no-op.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This migration is deprecated. No down operation needed.
  }

  private async hasTimestampColumn(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<boolean> {
    const tableInfo = await queryRunner.query(`PRAGMA table_info(${table})`);
    const columnInfo = tableInfo.find((col: any) => col.name === column);

    // Check if column exists and if its type is 'TIMESTAMP'
    return columnInfo && columnInfo.type.toUpperCase() === 'TIMESTAMP';
  }
}
