import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRLSTableEnhancements1774200000000
  implements MigrationInterface
{
  name = 'AddRLSTableEnhancements1774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Recreate rls_join_paths with is_active and UNIQUE name
    await queryRunner.query(`
      CREATE TABLE "rls_join_paths_new" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR NOT NULL UNIQUE,
        "target_table" VARCHAR NOT NULL,
        "chain" TEXT NOT NULL,
        "is_active" INTEGER NOT NULL DEFAULT 1,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "rls_join_paths_new" ("id", "name", "target_table", "chain", "created_at", "updated_at")
      SELECT "id", "name", "target_table", "chain", "created_at", "updated_at" FROM "rls_join_paths"
    `);

    await queryRunner.query(`DROP TABLE "rls_join_paths"`);
    await queryRunner.query(
      `ALTER TABLE "rls_join_paths_new" RENAME TO "rls_join_paths"`,
    );

    await queryRunner.query(`
      CREATE INDEX "IDX_rls_join_paths_is_active" ON "rls_join_paths" ("is_active")
    `);

    // Recreate rls_scope_templates with new columns and UNIQUE name
    await queryRunner.query(`
      CREATE TABLE "rls_scope_templates_new" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR NOT NULL UNIQUE,
        "join_path_id" INTEGER NOT NULL,
        "target_table" VARCHAR NOT NULL,
        "available_columns" TEXT NOT NULL,
        "description" TEXT,
        "scope_sql" TEXT NOT NULL,
        "parameters" TEXT,
        "is_active" INTEGER NOT NULL DEFAULT 1,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY ("join_path_id") REFERENCES "rls_join_paths" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      INSERT INTO "rls_scope_templates_new" ("id", "name", "join_path_id", "target_table", "available_columns", "created_at", "updated_at")
      SELECT "id", "name", "join_path_id", "target_table", "available_columns", "created_at", "updated_at" FROM "rls_scope_templates"
    `);

    await queryRunner.query(`DROP TABLE "rls_scope_templates"`);
    await queryRunner.query(
      `ALTER TABLE "rls_scope_templates_new" RENAME TO "rls_scope_templates"`,
    );

    await queryRunner.query(`
      CREATE INDEX "IDX_rls_scope_templates_is_active" ON "rls_scope_templates" ("is_active")
    `);

    // Add columns to rls_rules (SQLite supports ADD COLUMN for simple cases)
    await queryRunner.query(`
      ALTER TABLE "rls_rules" ADD COLUMN "is_active" INTEGER NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      ALTER TABLE "rls_rules" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "rls_rules" ADD COLUMN "description" TEXT
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_rls_rules_is_active" ON "rls_rules" ("is_active")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indices first
    await queryRunner.query(`DROP INDEX "IDX_rls_rules_is_active"`);
    await queryRunner.query(`DROP INDEX "IDX_rls_scope_templates_is_active"`);
    await queryRunner.query(`DROP INDEX "IDX_rls_join_paths_is_active"`);

    // Recreate rls_join_paths without new columns
    await queryRunner.query(`
      CREATE TABLE "rls_join_paths_old" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR NOT NULL,
        "target_table" VARCHAR NOT NULL,
        "chain" TEXT NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "rls_join_paths_old" ("id", "name", "target_table", "chain", "created_at", "updated_at")
      SELECT "id", "name", "target_table", "chain", "created_at", "updated_at" FROM "rls_join_paths"
    `);

    await queryRunner.query(`DROP TABLE "rls_join_paths"`);
    await queryRunner.query(
      `ALTER TABLE "rls_join_paths_old" RENAME TO "rls_join_paths"`,
    );

    // Recreate rls_scope_templates without new columns
    await queryRunner.query(`
      CREATE TABLE "rls_scope_templates_old" (
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

    await queryRunner.query(`
      INSERT INTO "rls_scope_templates_old" ("id", "name", "join_path_id", "target_table", "available_columns", "created_at", "updated_at")
      SELECT "id", "name", "join_path_id", "target_table", "available_columns", "created_at", "updated_at" FROM "rls_scope_templates"
    `);

    await queryRunner.query(`DROP TABLE "rls_scope_templates"`);
    await queryRunner.query(
      `ALTER TABLE "rls_scope_templates_old" RENAME TO "rls_scope_templates"`,
    );

    // Note: SQLite does not support dropping columns, so rls_rules columns remain
  }
}
