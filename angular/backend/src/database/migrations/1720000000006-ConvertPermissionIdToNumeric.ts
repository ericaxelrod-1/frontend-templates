import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertPermissionIdToNumeric1720000000006 implements MigrationInterface {
  name = 'ConvertPermissionIdToNumeric1720000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping redundant migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
