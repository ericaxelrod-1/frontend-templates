import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrivacyEntities1777327198305 implements MigrationInterface {
    name = 'AddPrivacyEntities1777327198305'

    public async up(queryRunner: QueryRunner): Promise<void> {
        try {
            await queryRunner.query(`SELECT 1 FROM privacy_tickets LIMIT 1`);
        } catch {
            await queryRunner.query(`
                CREATE TABLE "privacy_tickets" (
                    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    "request_type" varchar NOT NULL CHECK( "request_type" IN ('export','erasure','restriction','objection','correction','portability') ),
                    "status" varchar NOT NULL DEFAULT ('pending') CHECK( "status" IN ('unverified','pending','in_review','completed','failed','partial_success') ),
                    "user_id" integer,
                    "email" varchar,
                    "regulation" varchar NOT NULL CHECK( "regulation" IN ('gdpr','ccpa','other') ),
                    "sla_deadline" datetime,
                    "accrued_paused_time" integer NOT NULL DEFAULT (0),
                    "verified_at" datetime,
                    "description" text,
                    "created_at" datetime NOT NULL DEFAULT (datetime('now'))
                )
            `);
        }

        try {
            await queryRunner.query(`SELECT 1 FROM privacy_jobs LIMIT 1`);
        } catch {
            await queryRunner.query(`
                CREATE TABLE "privacy_jobs" (
                    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    "ticket_id" integer NOT NULL,
                    "status" varchar NOT NULL DEFAULT ('pending') CHECK( "status" IN ('pending','processing','completed','failed') ),
                    "provider_results" text,
                    "locked_at" datetime,
                    "error_log" text,
                    FOREIGN KEY ("ticket_id") REFERENCES "privacy_tickets" ("id") ON DELETE CASCADE
                )
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "privacy_jobs"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "privacy_tickets"`);
    }
}