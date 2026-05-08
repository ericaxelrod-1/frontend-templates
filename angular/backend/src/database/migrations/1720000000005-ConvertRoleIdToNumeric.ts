import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertRoleIdToNumeric1720000000005 implements MigrationInterface {
  name = 'ConvertRoleIdToNumeric1720000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping redundant migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
