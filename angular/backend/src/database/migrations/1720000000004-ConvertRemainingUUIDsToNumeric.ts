import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertRemainingUUIDsToNumeric1720000000004 implements MigrationInterface {
  name = 'ConvertRemainingUUIDsToNumeric1720000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping redundant migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
