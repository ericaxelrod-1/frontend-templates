import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDescriptionToPrivacyTickets1777327370750 implements MigrationInterface {
    name = 'AddDescriptionToPrivacyTickets1777327370750'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "privacy_tickets" ADD COLUMN "description" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "privacy_tickets" DROP COLUMN "description"`);
    }
}
