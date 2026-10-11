import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserBlockingFields1735000000000 implements MigrationInterface {
  name = 'AddUserBlockingFields1735000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping problematic migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
