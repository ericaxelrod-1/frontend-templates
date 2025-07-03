import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserBlockingFields1735000000000 implements MigrationInterface {
  name = 'AddUserBlockingFields1735000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "is_blocked" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "blocked_at" datetime
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "blocked_until" datetime
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "blocked_reason" text
    `);

    // Create index for efficient blocked user queries
    await queryRunner.query(`
      CREATE INDEX "IDX_users_is_blocked" ON "users" ("is_blocked")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_is_blocked"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "blocked_reason"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "blocked_until"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "blocked_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_blocked"`);
  }
}
