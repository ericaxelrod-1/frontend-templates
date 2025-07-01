import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActionReferenceToPermission1720000000101
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create actions table if it doesn't exist
    const hasActionsTable = await queryRunner.hasTable('actions');
    if (!hasActionsTable) {
      await queryRunner.query(`
        CREATE TABLE "actions" (
          "id" SERIAL PRIMARY KEY,
          "name" varchar NOT NULL UNIQUE,
          "description" varchar,
          "action_name" varchar NOT NULL,
          "icon" varchar,
          "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert basic actions
      await queryRunner.query(`
        INSERT INTO "actions" ("name", "description", "action_name", "icon") VALUES
          ('create', 'Create a new resource', 'create', 'add'),
          ('read', 'View a resource', 'read', 'visibility'),
          ('update', 'Update an existing resource', 'update', 'edit'),
          ('delete', 'Delete a resource', 'delete', 'delete'),
          ('admin', 'Administer all aspects of this resource', 'admin', 'settings')
      `);
    }

    // Add action_id column to permissions table if it doesn't exist
    const hasActionIdColumn = await queryRunner.hasColumn(
      'permissions',
      'action_id',
    );
    if (!hasActionIdColumn) {
      await queryRunner.query(
        `ALTER TABLE "permissions" ADD "action_id" integer`,
      );

      // Add foreign key constraint
      await queryRunner.query(`
        ALTER TABLE "permissions"
        ADD CONSTRAINT "FK_permissions_action_id" FOREIGN KEY ("action_id")
        REFERENCES "actions" ("id") ON DELETE SET NULL
      `);

      // Update action_id based on existing action_name
      await queryRunner.query(`
        UPDATE "permissions" p
        SET "action_id" = a.id
        FROM "actions" a
        WHERE p."action_name" = a."action_name"
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove foreign key constraint
    const hasForeignKey = await queryRunner.hasColumn(
      'permissions',
      'action_id',
    );
    if (hasForeignKey) {
      try {
        await queryRunner.query(
          `ALTER TABLE "permissions" DROP CONSTRAINT "FK_permissions_action_id"`,
        );
      } catch (error) {
        console.warn('Foreign key constraint not found or already dropped');
      }

      // Remove action_id column
      await queryRunner.query(
        `ALTER TABLE "permissions" DROP COLUMN "action_id"`,
      );
    }

    // We don't drop the actions table in the down migration to preserve action data
    // If needed, it can be handled by a separate migration
  }
}
