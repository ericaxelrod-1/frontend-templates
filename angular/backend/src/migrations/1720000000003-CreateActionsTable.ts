import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateActionsTable1720000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create actions table
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
            isUnique: true,
          },
          {
            name: 'description',
            type: 'varchar',
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
          },
        ],
      }),
      true,
    );

    // Create temporary table to store existing action names
    await queryRunner.query(`
      CREATE TABLE temp_actions AS
      SELECT DISTINCT action_name as name,
             'Action: ' || action_name as description,
             CURRENT_TIMESTAMP as created_at,
             CURRENT_TIMESTAMP as updated_at
      FROM permissions;
    `);

    // Insert unique actions into actions table
    await queryRunner.query(`
      INSERT INTO actions (name, description, created_at, updated_at)
      SELECT name, description, created_at, updated_at
      FROM temp_actions;
    `);

    // Drop temporary table
    await queryRunner.query(`DROP TABLE temp_actions;`);

    // Add action_id column to permissions table
    await queryRunner.query(`
      ALTER TABLE permissions
      ADD COLUMN action_id integer;
    `);

    // Update action_id references
    await queryRunner.query(`
      UPDATE permissions
      SET action_id = (
        SELECT id FROM actions
        WHERE actions.name = permissions.action_name
      );
    `);

    // Create foreign key constraint
    await queryRunner.createForeignKey(
      'permissions',
      new TableForeignKey({
        columnNames: ['action_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'actions',
        onDelete: 'CASCADE',
      }),
    );

    // Make action_id not nullable
    await queryRunner.query(`
      ALTER TABLE permissions
      ALTER COLUMN action_id SET NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove foreign key constraint
    const table = await queryRunner.getTable('permissions');
    const foreignKey = table.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('action_id') !== -1,
    );
    await queryRunner.dropForeignKey('permissions', foreignKey);

    // Remove action_id column
    await queryRunner.query(`
      ALTER TABLE permissions
      DROP COLUMN action_id;
    `);

    // Drop actions table
    await queryRunner.dropTable('actions');
  }
}
