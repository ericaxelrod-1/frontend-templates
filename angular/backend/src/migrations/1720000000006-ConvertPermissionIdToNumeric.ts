import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertPermissionIdToNumeric1720000000006
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create backup tables
    await queryRunner.query(
      `CREATE TABLE "permissions_backup" AS SELECT * FROM "permissions"`,
    );
    await queryRunner.query(
      `CREATE TABLE "role_permissions_backup" AS SELECT * FROM "role_permissions"`,
    );

    // Update the permissions table to use numeric IDs
    // 1. Create a new permissions table with numeric ID
    await queryRunner.query(`
      CREATE TABLE "permissions_new" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar UNIQUE,
        "description" varchar NULL,
        "resource_name" varchar NOT NULL,
        "action" varchar NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Copy data from permissions to permissions_new
    await queryRunner.query(`
      INSERT INTO "permissions_new" (name, description, resource_name, action, created_at, updated_at)
      SELECT name, description, resource_name, action, created_at, updated_at
      FROM "permissions"
    `);

    // 3. Create a mapping table to track UUID to numeric ID
    await queryRunner.query(`
      CREATE TABLE "permission_id_mapping" (
        "old_id" uuid NOT NULL,
        "new_id" integer NOT NULL,
        PRIMARY KEY ("old_id")
      )
    `);

    // 4. Populate the mapping table
    await queryRunner.query(`
      INSERT INTO "permission_id_mapping" (old_id, new_id)
      SELECT p.id, pn.id
      FROM "permissions" p
      JOIN "permissions_new" pn ON p.name = pn.name
    `);

    // 5. Create new role_permissions table with numeric IDs
    await queryRunner.query(`
      CREATE TABLE "role_permissions_new" (
        "id" SERIAL PRIMARY KEY,
        "role_id" integer NOT NULL,
        "permission_id" integer NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Copy data to new role_permissions table with mapped IDs
    await queryRunner.query(`
      INSERT INTO "role_permissions_new" (role_id, permission_id, created_at, updated_at)
      SELECT rp.role_id, m.new_id, rp.created_at, rp.updated_at
      FROM "role_permissions" rp
      JOIN "permission_id_mapping" m ON rp.permission_id = m.old_id
    `);

    // 7. Drop old tables and rename new ones
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(
      `ALTER TABLE "permissions_new" RENAME TO "permissions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions_new" RENAME TO "role_permissions"`,
    );

    // 8. Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "role_permissions"
      ADD CONSTRAINT "FK_role_permissions_role_id" FOREIGN KEY ("role_id")
      REFERENCES "roles" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "role_permissions"
      ADD CONSTRAINT "FK_role_permissions_permission_id" FOREIGN KEY ("permission_id")
      REFERENCES "permissions" ("id") ON DELETE CASCADE
    `);

    // 9. Clean up mapping table
    await queryRunner.query(`DROP TABLE "permission_id_mapping"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // In case of rollback, restore from backups
    if (
      (await queryRunner.hasTable('permissions_backup')) &&
      (await queryRunner.hasTable('role_permissions_backup'))
    ) {
      // Drop foreign key constraints
      const rolePermissionsTable =
        await queryRunner.getTable('role_permissions');
      const roleIdForeignKey = rolePermissionsTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('role_id') !== -1,
      );
      const permissionIdForeignKey = rolePermissionsTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('permission_id') !== -1,
      );

      await queryRunner.dropForeignKey('role_permissions', roleIdForeignKey);
      await queryRunner.dropForeignKey(
        'role_permissions',
        permissionIdForeignKey,
      );

      // Drop current tables
      await queryRunner.query(`DROP TABLE "role_permissions"`);
      await queryRunner.query(`DROP TABLE "permissions"`);

      // Restore from backups
      await queryRunner.query(
        `ALTER TABLE "permissions_backup" RENAME TO "permissions"`,
      );
      await queryRunner.query(
        `ALTER TABLE "role_permissions_backup" RENAME TO "role_permissions"`,
      );
    } else {
      throw new Error(
        'Backup tables not found, cannot safely roll back the migration',
      );
    }
  }
}
