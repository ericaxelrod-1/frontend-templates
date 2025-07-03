import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class AddActionPermissions1684156801000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create actions table if it doesn't exist
    await queryRunner.createTable(
      new Table({
        name: 'actions',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '50',
            isUnique: true,
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
            length: '50',
          },
          {
            name: 'icon',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add action_id column to permissions table if it doesn't exist
    const permissionsTable = await queryRunner.getTable('permissions');
    if (permissionsTable && !permissionsTable.findColumnByName('action_id')) {
      await queryRunner.query(
        `ALTER TABLE permissions ADD COLUMN action_id INT NULL`,
      );

      // Add foreign key for action_id
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

    // Insert default actions
    await queryRunner.query(`
      INSERT INTO actions (name, description, action_name, icon)
      VALUES 
        ('create', 'Create new resources', 'create', 'add'),
        ('read', 'Read resources', 'read', 'visibility'),
        ('update', 'Update existing resources', 'update', 'edit'),
        ('delete', 'Delete resources', 'delete', 'delete'),
        ('manage', 'Full control over resources', 'manage', 'settings')
      ON DUPLICATE KEY UPDATE 
        description = VALUES(description),
        action_name = VALUES(action_name),
        icon = VALUES(icon)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the action_id foreign key from permissions table
    const permissionsTable = await queryRunner.getTable('permissions');
    if (permissionsTable) {
      const actionForeignKey = permissionsTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('action_id') !== -1,
      );
      if (actionForeignKey) {
        await queryRunner.dropForeignKey('permissions', actionForeignKey);
      }

      // Remove action_id column from permissions table
      if (permissionsTable.findColumnByName('action_id')) {
        await queryRunner.query(
          `ALTER TABLE permissions DROP COLUMN action_id`,
        );
      }
    }

    // Drop actions table
    await queryRunner.dropTable('actions', true);
  }
}
