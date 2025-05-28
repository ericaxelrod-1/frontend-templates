import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionsToCacheMap1684156803000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add permissions column to cache_permission_maps table
    await queryRunner.query(`
      ALTER TABLE cache_permission_maps 
      ADD COLUMN permissions TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove permissions column
    await queryRunner.query(`
      ALTER TABLE cache_permission_maps 
      DROP COLUMN permissions;
    `);
  }
} 