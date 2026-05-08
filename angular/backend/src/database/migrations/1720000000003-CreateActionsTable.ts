import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateActionsTable1720000000003 implements MigrationInterface {
  name = 'CreateActionsTable1720000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping redundant migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
