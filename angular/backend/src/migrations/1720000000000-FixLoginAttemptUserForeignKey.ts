import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixLoginAttemptUserForeignKey1720000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing foreign key if it exists
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name='FK_login_attempt_user' 
          AND table_name='login_attempt'
        ) THEN
          ALTER TABLE "login_attempt" DROP CONSTRAINT "FK_login_attempt_user";
        END IF;
      END $$;
    `);

    // Create new foreign key to users table
    await queryRunner.query(`
      ALTER TABLE "login_attempt" 
      ADD CONSTRAINT "FK_login_attempt_user" 
      FOREIGN KEY ("userId") 
      REFERENCES "users"("id") 
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key
    await queryRunner.query(`
      ALTER TABLE "login_attempt" DROP CONSTRAINT "FK_login_attempt_user"
    `);

    // Recreate original foreign key (if needed)
    // This migration doesn't recreate the original broken FK
  }
}
