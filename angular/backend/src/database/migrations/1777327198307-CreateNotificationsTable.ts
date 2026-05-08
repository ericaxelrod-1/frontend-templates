import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsTable1777327198307 implements MigrationInterface {
  name = 'CreateNotificationsTable1777327198307';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "user_id" integer NOT NULL,
        "type" varchar NOT NULL CHECK( "type" IN ('info','success','warning','error','privacy','security','system') ),
        "title" varchar NOT NULL,
        "message" text NOT NULL,
        "link" varchar,
        "is_read" boolean NOT NULL DEFAULT (0),
        "read_at" datetime,
        "is_archived" boolean NOT NULL DEFAULT (0),
        "expires_at" datetime,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        "userId" integer,
        CONSTRAINT "FK_notifications_user" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "user_id" integer NOT NULL UNIQUE,
        "email_enabled" boolean NOT NULL DEFAULT (1),
        "push_enabled" boolean NOT NULL DEFAULT (1),
        "sms_enabled" boolean NOT NULL DEFAULT (0),
        "privacy_enabled" boolean NOT NULL DEFAULT (1),
        "security_enabled" boolean NOT NULL DEFAULT (1),
        "system_enabled" boolean NOT NULL DEFAULT (1),
        "marketing_enabled" boolean NOT NULL DEFAULT (0),
        "userId" integer,
        CONSTRAINT "REL_notification_preferences_user" UNIQUE ("userId"),
        CONSTRAINT "FK_notification_preferences_user" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    console.log('Successfully created notifications and notification_preferences tables.');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    console.log('Rolled back notifications tables.');
  }
}
