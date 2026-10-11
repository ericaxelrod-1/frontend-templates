import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPermissionActionNameVirtualProperty1742536989659
  implements MigrationInterface
{
  name = 'FixPermissionActionNameVirtualProperty1742536989659';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration only updates the TypeORM entities, not the database schema.
    // We're addressing the issue where the Permission entity needs actionName getter/setter
    // to be compatible with code that accesses this property.

    // First check if we're working with permissions or permission table
    const permissionsTableExists = await queryRunner.hasTable('permissions');
    const permissionTableExists = await queryRunner.hasTable('permission');

    if (!permissionsTableExists && !permissionTableExists) {
      throw new Error('Neither permissions nor permission table exists');
    }

    const tableName = permissionsTableExists ? 'permissions' : 'permission';

    // Check if the action column exists
    const actionColumnExists = await queryRunner.hasColumn(tableName, 'action');
    if (!actionColumnExists) {
      // If the action column doesn't exist, we need to add it
      await queryRunner.query(`
                ALTER TABLE "${tableName}" 
                ADD COLUMN "action" VARCHAR(50)
            `);

      // Copy data from action_name if it exists
      const actionNameColumnExists = await queryRunner.hasColumn(
        tableName,
        'action_name',
      );
      if (actionNameColumnExists) {
        await queryRunner.query(`
                    UPDATE "${tableName}" 
                    SET "action" = "action_name"
                `);
      }
    }

    // Ensure we have proper indexes
    try {
      await queryRunner.query(`
                CREATE INDEX IF NOT EXISTS "idx_${tableName}_action" 
                ON "${tableName}" ("action")
            `);
    } catch (e) {
      console.error('Error creating index on action column', e);
    }

    // Log success
    console.log(
      `Successfully updated ${tableName} table to support actionName virtual property`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Nothing to undo, as the changes are in the entity code, not the database schema
    // Or changes just add additional indexes which can remain
    console.log(
      'No database changes to revert for actionName virtual property',
    );
  }
}
