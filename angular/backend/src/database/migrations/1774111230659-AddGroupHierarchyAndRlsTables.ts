import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupHierarchyAndRlsTables1774111230659
  implements MigrationInterface
{
  name = 'AddGroupHierarchyAndRlsTables1774111230659';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add Group hierarchy columns
    await queryRunner.query(`
      ALTER TABLE "groups" ADD COLUMN "parent_id" INTEGER
    `);
    await queryRunner.query(`
      ALTER TABLE "groups" ADD COLUMN "priority" INTEGER
    `);

    await queryRunner.query(`
      ALTER TABLE "groups" ADD CONSTRAINT "FK_groups_parent" 
      FOREIGN KEY ("parent_id") REFERENCES "groups" ("id") ON DELETE SET NULL
    `);

    // Create index for parent_id on groups
    await queryRunner.query(`
      CREATE INDEX "IDX_groups_parent_id" ON "groups" ("parent_id")
    `);

    // RLS Join Paths table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_join_paths" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR(255) NOT NULL,
        "target_table" VARCHAR(255) NOT NULL,
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
        "from_table" VARCHAR(255) NOT NULL,
        "from_column" VARCHAR(255) NOT NULL,
        "to_table" VARCHAR(255) NOT NULL,
        "to_column" VARCHAR(255) NOT NULL,
        "operator" VARCHAR(50) NOT NULL DEFAULT '=',
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_rls_join_conditions_path" 
        FOREIGN KEY ("join_path_id") REFERENCES "rls_join_paths" ("id") ON DELETE CASCADE
      )
    `);

    // RLS Rules table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_rules" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "group_id" INTEGER NOT NULL,
        "target_table" VARCHAR(255) NOT NULL,
        "sql" TEXT NOT NULL,
        "parameters" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_rls_rules_group" 
        FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE
      )
    `);

    // RLS Scope Templates table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_scope_templates" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" VARCHAR(255) NOT NULL,
        "join_path_id" INTEGER NOT NULL,
        "target_table" VARCHAR(255) NOT NULL,
        "available_columns" TEXT NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_rls_scope_templates_path" 
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

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_groups_parent_id"`);
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "priority"`);
    await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "parent_id"`);
  }
}
