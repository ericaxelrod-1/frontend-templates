import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoginMonitoringTables1711591600000
  implements MigrationInterface
{
  name = 'AddLoginMonitoringTables1711591600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add is_email_verified column to User table if it doesn't exist (not present in current schema, so skip)
    // await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_email_verified" BOOLEAN NOT NULL DEFAULT (0);`);

    // Create login_attempt table (singular)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "login_attempt" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        "ipAddress" TEXT NOT NULL,
        "userAgent" TEXT NOT NULL,
        "email" TEXT,
        "status" TEXT NOT NULL DEFAULT 'failed',
        "userId" INTEGER,
        "failureReason" TEXT,
        "metadata" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    // Create ip_reputation table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ip_reputation" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "ipAddress" TEXT UNIQUE NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'good',
        "reputationScore" FLOAT DEFAULT 100,
        "geoLocation" TEXT,
        "statistics" TEXT,
        "blockHistory" TEXT,
        "failedAttempts" INTEGER DEFAULT 0,
        "isBlocked" BOOLEAN DEFAULT 0,
        "blockedUntil" DATETIME,
        "captchaRequiredCount" INTEGER DEFAULT 0,
        "metadata" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updatedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create captcha table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "captcha" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "type" TEXT DEFAULT 'text',
        "token" TEXT NOT NULL,
        "challenge" TEXT NOT NULL,
        "solution" TEXT NOT NULL,
        "used" BOOLEAN NOT NULL DEFAULT 0,
        "expiresAt" DATETIME NOT NULL,
        "ipAddress" TEXT,
        "metadata" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create indexes for better query performance
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_login_attempt_ip" ON "login_attempt" ("ipAddress")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_login_attempt_email" ON "login_attempt" ("email")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_login_attempt_status" ON "login_attempt" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_login_attempt_created" ON "login_attempt" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ip_reputation_blocked" ON "ip_reputation" ("isBlocked")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_captcha_expires" ON "captcha" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_captcha_expires"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ip_reputation_blocked"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_attempt_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_attempt_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_attempt_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_attempt_ip"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "captcha"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ip_reputation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "login_attempt"`);
  }
}
