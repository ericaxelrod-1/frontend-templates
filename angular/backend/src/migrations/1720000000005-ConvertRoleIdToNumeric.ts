import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertRoleIdToNumeric1720000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create backup tables
    await queryRunner.query(
      `CREATE TABLE "roles_backup" AS SELECT * FROM "roles"`,
    );
    await queryRunner.query(
      `CREATE TABLE "role_permissions_backup" AS SELECT * FROM "role_permissions"`,
    );

    // Update the roles table to use numeric IDs
    // 1. Create a new roles table with numeric ID
    await queryRunner.query(`
      CREATE TABLE "roles_new" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar UNIQUE,
        "description" varchar NULL,
        "is_system_role" boolean DEFAULT false,
        "is_default" boolean DEFAULT false,
        "parent_id" integer NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Copy data from roles to roles_new
    await queryRunner.query(`
      INSERT INTO "roles_new" (name, description, is_system_role, is_default, created_at, updated_at)
      SELECT name, description, is_system_role, is_default, created_at, updated_at
      FROM "roles"
    `);

    // 3. Create a mapping table to track UUID to numeric ID
    await queryRunner.query(`
      CREATE TABLE "role_id_mapping" (
        "old_id" uuid NOT NULL,
        "new_id" integer NOT NULL,
        PRIMARY KEY ("old_id")
      )
    `);

    // 4. Populate the mapping table
    await queryRunner.query(`
      INSERT INTO "role_id_mapping" (old_id, new_id)
      SELECT r.id, rn.id
      FROM "roles" r
      JOIN "roles_new" rn ON r.name = rn.name
    `);

    // 5. Update parent_id references in roles_new
    await queryRunner.query(`
      UPDATE "roles_new" rn
      SET parent_id = m.new_id
      FROM "roles" r
      JOIN "role_id_mapping" m ON r.parent_id = m.old_id
      WHERE r.name = rn.name AND r.parent_id IS NOT NULL
    `);

    // 6. Create new role_permissions table with numeric IDs
    await queryRunner.query(`
      CREATE TABLE "role_permissions_new" (
        "id" SERIAL PRIMARY KEY,
        "role_id" integer NOT NULL,
        "permission_id" integer NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Copy data to new role_permissions table with mapped IDs
    await queryRunner.query(`
      INSERT INTO "role_permissions_new" (role_id, permission_id, created_at, updated_at)
      SELECT m.new_id, rp.permission_id, rp.created_at, rp.updated_at
      FROM "role_permissions" rp
      JOIN "role_id_mapping" m ON rp.role_id = m.old_id
    `);

    // 8. Drop old tables and rename new ones
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`ALTER TABLE "roles_new" RENAME TO "roles"`);
    await queryRunner.query(
      `ALTER TABLE "role_permissions_new" RENAME TO "role_permissions"`,
    );

    // 9. Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "roles"
      ADD CONSTRAINT "FK_roles_parent_id" FOREIGN KEY ("parent_id")
      REFERENCES "roles" ("id") ON DELETE SET NULL
    `);

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

    // 10. Clean up mapping table
    await queryRunner.query(`DROP TABLE "role_id_mapping"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // In case of rollback, restore from backups
    if (
      (await queryRunner.hasTable('roles_backup')) &&
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

      // Drop parent_id foreign key from roles table
      const rolesTable = await queryRunner.getTable('roles');
      const parentIdForeignKey = rolesTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('parent_id') !== -1,
      );
      await queryRunner.dropForeignKey('roles', parentIdForeignKey);

      // Drop current tables
      await queryRunner.query(`DROP TABLE "role_permissions"`);
      await queryRunner.query(`DROP TABLE "roles"`);

      // Restore from backups
      await queryRunner.query(`ALTER TABLE "roles_backup" RENAME TO "roles"`);
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
