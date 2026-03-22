import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRlsTableColumns1800000000002 implements MigrationInterface {
  private async addColumnIfNotExists(
    queryRunner: QueryRunner,
    tableName: string,
    column: TableColumn,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const exists = table?.columns.some((c) => c.name === column.name);
    if (!exists) {
      await queryRunner.addColumn(tableName, column);
    }
  }

  private async dropColumnIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const exists = table?.columns.some((c) => c.name === columnName);
    if (exists) {
      await queryRunner.dropColumn(tableName, columnName);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfNotExists(
      queryRunner,
      'rls_join_paths',
      new TableColumn({
        name: 'is_active',
        type: 'INTEGER',
        default: 1,
      }),
    );

    await this.addColumnIfNotExists(
      queryRunner,
      'rls_rules',
      new TableColumn({
        name: 'is_active',
        type: 'INTEGER',
        default: 1,
      }),
    );

    await this.addColumnIfNotExists(
      queryRunner,
      'rls_rules',
      new TableColumn({
        name: 'priority',
        type: 'INTEGER',
        isNullable: true,
      }),
    );

    await this.addColumnIfNotExists(
      queryRunner,
      'rls_rules',
      new TableColumn({
        name: 'description',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await this.addColumnIfNotExists(
      queryRunner,
      'rls_scope_templates',
      new TableColumn({
        name: 'is_active',
        type: 'INTEGER',
        default: 1,
      }),
    );

    await this.addColumnIfNotExists(
      queryRunner,
      'rls_scope_templates',
      new TableColumn({
        name: 'description',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await this.addColumnIfNotExists(
      queryRunner,
      'rls_scope_templates',
      new TableColumn({
        name: 'scope_sql',
        type: 'text',
        isNullable: true,
      }),
    );

    await this.addColumnIfNotExists(
      queryRunner,
      'rls_scope_templates',
      new TableColumn({
        name: 'parameters',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropColumnIfExists(queryRunner, 'rls_scope_templates', 'parameters');
    await this.dropColumnIfExists(queryRunner, 'rls_scope_templates', 'scope_sql');
    await this.dropColumnIfExists(queryRunner, 'rls_scope_templates', 'description');
    await this.dropColumnIfExists(queryRunner, 'rls_scope_templates', 'is_active');
    await this.dropColumnIfExists(queryRunner, 'rls_rules', 'description');
    await this.dropColumnIfExists(queryRunner, 'rls_rules', 'priority');
    await this.dropColumnIfExists(queryRunner, 'rls_rules', 'is_active');
    await this.dropColumnIfExists(queryRunner, 'rls_join_paths', 'is_active');
  }
}
