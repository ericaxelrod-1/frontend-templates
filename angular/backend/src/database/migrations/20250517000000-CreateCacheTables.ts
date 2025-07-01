import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCacheTables20250517000000 implements MigrationInterface {
  name = 'CreateCacheTables20250517000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // cache_components table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cache_components" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "selector" VARCHAR(255) NOT NULL UNIQUE,
        "description" TEXT,
        "file_path" VARCHAR(255),
        "last_synced_at" DATETIME,
        "metadata" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // cache_routes table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cache_routes" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "path" VARCHAR(255) NOT NULL UNIQUE,
        "description" TEXT,
        "component_name" VARCHAR(255),
        "last_synced_at" DATETIME,
        "metadata" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // cache_endpoints table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cache_endpoints" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "method" VARCHAR(20) NOT NULL,
        "path" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "controller_name" VARCHAR(100),
        "handler_name" VARCHAR(100),
        "last_synced_at" DATETIME,
        "metadata" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        "updated_at" DATETIME NOT NULL DEFAULT (datetime('now')),
        UNIQUE("method", "path")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cache_endpoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cache_routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cache_components"`);
  }
}
