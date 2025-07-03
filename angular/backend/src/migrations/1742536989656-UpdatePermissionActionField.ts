import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class UpdatePermissionActionField1742536989656
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if the permissions table exists
    const permissionsTable = await queryRunner.hasTable('permissions');
    if (!permissionsTable) {
      return;
    }

    try {
      // Create a backup table for permissions
      await queryRunner.query(
        `CREATE TABLE IF NOT EXISTS permissions_backup AS SELECT * FROM permissions`,
      );

      // Check if the action_name column already exists
      const table = await queryRunner.getTable('permissions');
      const actionNameColumn = table.findColumnByName('action_name');

      if (!actionNameColumn) {
        // Add action_name column if it doesn't exist
        await queryRunner.addColumn(
          'permissions',
          new TableColumn({
            name: 'action_name',
            type: 'varchar',
            isNullable: true,
          }),
        );

        // Copy action values to action_name for backward compatibility
        await queryRunner.query(`
          UPDATE permissions 
          SET action_name = action 
          WHERE action_name IS NULL AND action IS NOT NULL
        `);
      }

      // Add action_id column if it doesn't exist
      const actionIdColumn = table.findColumnByName('action_id');
      if (!actionIdColumn) {
        await queryRunner.addColumn(
          'permissions',
          new TableColumn({
            name: 'action_id',
            type: 'integer',
            isNullable: true,
          }),
        );
      }

      // Synchronize action IDs with the actions table if possible
      await queryRunner.query(`
        UPDATE permissions 
        SET action_id = (
          SELECT id FROM actions 
          WHERE actions.name = permissions.action 
          LIMIT 1
        )
        WHERE action_id IS NULL AND action IS NOT NULL
      `);
    } catch (error) {
      console.error('Migration failed:', error);
      // Roll back using the backup table
      await queryRunner.query(`DROP TABLE IF EXISTS permissions`);
      await queryRunner.query(
        `ALTER TABLE permissions_backup RENAME TO permissions`,
      );
      throw error;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('permissions');

    // Check if the table exists
    if (!table) {
      return;
    }

    // Check if the action_name column exists
    const actionNameColumn = table.findColumnByName('action_name');
    if (actionNameColumn) {
      await queryRunner.dropColumn('permissions', 'action_name');
    }

    // Restore from backup if it exists
    const backupExists = await queryRunner.hasTable('permissions_backup');
    if (backupExists) {
      await queryRunner.query(`DROP TABLE IF EXISTS permissions`);
      await queryRunner.query(
        `ALTER TABLE permissions_backup RENAME TO permissions`,
      );
    }
  }
}
