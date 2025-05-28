import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableColumn } from 'typeorm';

export class CreateActionsTable1742536989655 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('actions');
    if (!hasTable) {
      await queryRunner.createTable(
        new Table({
          name: 'actions',
          columns: [
            {
              name: 'id',
              type: 'integer',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            {
              name: 'name',
              type: 'varchar',
              length: '255',
              isUnique: true,
              isNullable: false,
            },
            {
              name: 'description',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'action_name',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'icon',
              type: 'varchar',
              length: '50',
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updated_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
        true,
      );

      // Add action_id column to permissions table if it doesn't exist
      const permissionsTable = await queryRunner.getTable('permissions');
      const hasActionIdColumn = permissionsTable.findColumnByName('action_id');
      
      if (!hasActionIdColumn) {
        await queryRunner.addColumn(
          'permissions',
          new TableColumn({
            name: 'action_id',
            type: 'integer',
            isNullable: true,
          }),
        );

        // Add foreign key
        await queryRunner.createForeignKey(
          'permissions',
          new TableForeignKey({
            columnNames: ['action_id'],
            referencedColumnNames: ['id'],
            referencedTableName: 'actions',
            onDelete: 'SET NULL',
          }),
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // First drop the foreign key if it exists
    const permissionsTable = await queryRunner.getTable('permissions');
    if (permissionsTable) {
      const foreignKey = permissionsTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('action_id') !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('permissions', foreignKey);
      }

      // Drop the action_id column if it exists
      const hasActionIdColumn = permissionsTable.findColumnByName('action_id');
      if (hasActionIdColumn) {
        await queryRunner.dropColumn('permissions', 'action_id');
      }
    }

    // Drop the actions table if it exists
    await queryRunner.dropTable('actions', true);
  }
} 