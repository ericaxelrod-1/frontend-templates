import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionRelationshipTables1720000000102 implements MigrationInterface {
  name = 'AddPermissionRelationshipTables1720000000102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Skipping problematic migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
