import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupHierarchyAndRlsTables1774111230659
  implements MigrationInterface
{
  name = 'AddGroupHierarchyAndRlsTables1774111230659';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // For SQLite, we need to recreate the groups table to add parent_id with FK constraint
    // Step 1: Create new table with the additional columns
    await queryRunner.query(`
      CREATE TABLE "groups_new" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR(50) UNIQUE NOT NULL,
        "description" VARCHAR(255),
        "settings" TEXT,
        "is_system_group" INTEGER DEFAULT 0,
        "owner_id" INTEGER,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "parent_id" INTEGER,
        "priority" INTEGER,
        FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE SET NULL,
        FOREIGN KEY ("parent_id") REFERENCES "groups" ("id") ON DELETE SET NULL
      )
    `);

    // Step 2: Copy data from old table to new table
    await queryRunner.query(`
      INSERT INTO "groups_new" ("id", "name", "description", "settings", "is_system_group", "owner_id", "created_at", "updated_at")
      SELECT "id", "name", "description", "settings", "is_system_group", "owner_id", "created_at", "updated_at" FROM "groups"
    `);

    // Step 3: Drop old table
    await queryRunner.query(`DROP TABLE "groups"`);

    // Step 4: Rename new table to original name
    await queryRunner.query(`ALTER TABLE "groups_new" RENAME TO "groups"`);

    // Step 5: Create index for parent_id
    await queryRunner.query(`
      CREATE INDEX "IDX_groups_parent_id" ON "groups" ("parent_id")
    `);

    // RLS Join Paths table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_join_paths" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR NOT NULL,
        "target_table" VARCHAR NOT NULL,
        "chain" TEXT NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // RLS Join Conditions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_join_conditions" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "join_path_id" INTEGER NOT NULL,
        "from_table" VARCHAR NOT NULL,
        "from_column" VARCHAR NOT NULL,
        "to_table" VARCHAR NOT NULL,
        "to_column" VARCHAR NOT NULL,
        "operator" VARCHAR DEFAULT '=',
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY ("join_path_id") REFERENCES "rls_join_paths" ("id") ON DELETE CASCADE
      )
    `);

    // RLS Rules table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_rules" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "group_id" INTEGER NOT NULL,
        "target_table" VARCHAR NOT NULL,
        "sql" TEXT NOT NULL,
        "parameters" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE
      )
    `);

    // RLS Scope Templates table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_scope_templates" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR NOT NULL,
        "join_path_id" INTEGER NOT NULL,
        "target_table" VARCHAR NOT NULL,
        "available_columns" TEXT NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY ("join_path_id") REFERENCES "rls_join_paths" ("id") ON DELETE CASCADE
      )
    `);

    // Create indices for RLS tables
    await queryRunner.query(`
      CREATE INDEX "IDX_rls_rules_group_id" ON "rls_rules" ("group_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_rls_rules_target_table" ON "rls_rules" ("target_table")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_rls_join_conditions_path_id" ON "rls_join_conditions" ("join_path_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_rls_scope_templates_join_path_id" ON "rls_scope_templates" ("join_path_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "rls_scope_templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rls_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rls_join_conditions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rls_join_paths"`);

    // For SQLite, recreate groups table without parent_id and priority
    await queryRunner.query(`
      CREATE TABLE "groups_old" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR(50) UNIQUE NOT NULL,
        "description" VARCHAR(255),
        "settings" TEXT,
        "is_system_group" INTEGER DEFAULT 0,
        "owner_id" INTEGER,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      INSERT INTO "groups_old" ("id", "name", "description", "settings", "is_system_group", "owner_id", "created_at", "updated_at")
      SELECT "id", "name", "description", "settings", "is_system_group", "owner_id", "created_at", "updated_at" FROM "groups"
    `);

    await queryRunner.query(`DROP TABLE "groups"`);
    await queryRunner.query(`ALTER TABLE "groups_old" RENAME TO "groups"`);
  }
}
