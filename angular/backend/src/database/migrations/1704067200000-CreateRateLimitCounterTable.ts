import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateRateLimitCounterTable1704067200000 implements MigrationInterface {
  name = 'CreateRateLimitCounterTable1704067200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'rate_limit_counter',
        columns: [
          {
            name: 'id',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'key',
            type: 'text',
            isUnique: true,
          },
          {
            name: 'count',
            type: 'integer',
            default: 0,
          },
          {
            name: 'window_expires_at',
            type: 'datetime',
          },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('rate_limit_counter');
  }
}
