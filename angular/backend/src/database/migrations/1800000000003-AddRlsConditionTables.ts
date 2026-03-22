import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRlsConditionTables1800000000003 implements MigrationInterface {
  name = 'AddRlsConditionTables1800000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_condition_groups" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "rule_id" INTEGER NOT NULL,
        "parent_group_id" INTEGER,
        "logical_operator" VARCHAR DEFAULT 'AND',
        "sort_order" INTEGER DEFAULT 0,
        FOREIGN KEY ("rule_id") REFERENCES "rls_rules" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("parent_group_id") REFERENCES "rls_condition_groups" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rls_rule_conditions" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "condition_group_id" INTEGER NOT NULL,
        "column_name" VARCHAR(255) NOT NULL,
        "operator" VARCHAR(20) NOT NULL,
        "value" TEXT,
        "sort_order" INTEGER DEFAULT 0,
        FOREIGN KEY ("condition_group_id") REFERENCES "rls_condition_groups" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "rls_rules" ADD COLUMN "root_group_id" INTEGER
      REFERENCES "rls_condition_groups" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_rls_condition_groups_rule_id" ON "rls_condition_groups" ("rule_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_rls_condition_groups_parent_group_id" ON "rls_condition_groups" ("parent_group_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_rls_rule_conditions_condition_group_id" ON "rls_rule_conditions" ("condition_group_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "rls_rule_conditions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rls_condition_groups"`);
    await queryRunner.query(`CREATE TABLE "rls_rules_new" AS SELECT id, group_id, target_table, sql, parameters, is_active, priority, description, created_at, updated_at FROM "rls_rules"`);
    await queryRunner.query(`DROP TABLE "rls_rules"`);
    await queryRunner.query(`ALTER TABLE "rls_rules_new" RENAME TO "rls_rules"`);
  }
}
