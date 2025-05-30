import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCacheSyncStatusTable1690000000002
  implements MigrationInterface
{
  name = 'CreateCacheSyncStatusTable1690000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "cache_sync_status" (
                "id" varchar PRIMARY KEY,
                "entityType" varchar NOT NULL,
                "lastSyncTime" datetime NOT NULL,
                "syncStats" text,
                "error" text,
                "syncSuccessful" boolean NOT NULL DEFAULT (1)
            )
        `);

    // Create initial records for each entity type
    const entityTypes = ['component', 'route', 'endpoint', 'permission'];
    const now = new Date().toISOString();

    for (const entityType of entityTypes) {
      await queryRunner.query(`
                INSERT INTO "cache_sync_status" 
                ("id", "entityType", "lastSyncTime", "syncStats", "syncSuccessful") 
                VALUES (
                    '${entityType}', 
                    '${entityType}', 
                    '${now}', 
                    '{"added":0,"updated":0,"deleted":0,"unchanged":0,"errors":0}', 
                    1
                )
                ON CONFLICT ("id") DO NOTHING
            `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cache_sync_status"`);
  }
}
