import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey } from 'typeorm';

export class AddRlsTableColumns1800000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add is_active to rls_join_paths
    await queryRunner.addColumn(
      'rls_join_paths',
      new TableColumn({
        name: 'is_active',
        type: 'INTEGER',
        default: 1,
      }),
    );

    // Add columns to rls_rules
    await queryRunner.addColumn(
      'rls_rules',
      new TableColumn({
        name: 'is_active',
        type: 'INTEGER',
        default: 1,
      }),
    );

    await queryRunner.addColumn(
      'rls_rules',
      new TableColumn({
        name: 'priority',
        type: 'INTEGER',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'rls_rules',
      new TableColumn({
        name: 'description',
        type: 'varchar',
        isNullable: true,
      }),
    );

    // Add columns to rls_scope_templates
    await queryRunner.addColumn(
      'rls_scope_templates',
      new TableColumn({
        name: 'is_active',
        type: 'INTEGER',
        default: 1,
      }),
    );

    await queryRunner.addColumn(
      'rls_scope_templates',
      new TableColumn({
        name: 'description',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'rls_scope_templates',
      new TableColumn({
        name: 'scope_sql',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'rls_scope_templates',
      new TableColumn({
        name: 'parameters',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('rls_scope_templates', 'parameters');
    await queryRunner.dropColumn('rls_scope_templates', 'scope_sql');
    await queryRunner.dropColumn('rls_scope_templates', 'description');
    await queryRunner.dropColumn('rls_scope_templates', 'is_active');
    await queryRunner.dropColumn('rls_rules', 'description');
    await queryRunner.dropColumn('rls_rules', 'priority');
    await queryRunner.dropColumn('rls_rules', 'is_active');
    await queryRunner.dropColumn('rls_join_paths', 'is_active');
  }
}
