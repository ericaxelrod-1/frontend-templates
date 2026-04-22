import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserBehaviorProfilesTable1742536990001
  implements MigrationInterface
{
  name = 'CreateUserBehaviorProfilesTable1742536990001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_behavior_profile" (
        "id" text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        "user_id" integer NOT NULL,
        "typical_login_hours" text,
        "known_ips" text,
        "known_user_agents" text,
        "created_at" datetime DEFAULT CURRENT_TIMESTAMP,
        "updated_at" datetime DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_user_behavior_profile_user" FOREIGN KEY ("user_id") 
          REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_behavior_profile_user_id" 
      ON "user_behavior_profile" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_behavior_profile_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_behavior_profile"`);
  }
}
