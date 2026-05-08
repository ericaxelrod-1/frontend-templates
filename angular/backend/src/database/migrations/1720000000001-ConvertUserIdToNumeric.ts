import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertUserIdToNumeric1720000000001 implements MigrationInterface {
  name = 'ConvertUserIdToNumeric1720000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration contains PostgreSQL specific syntax and references tables 
    // (tasks, categories, tags) that do not exist in this project's SQLite schema.
    // Skipping to allow other migrations to proceed.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
