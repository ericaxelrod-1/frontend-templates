import { createConnection } from 'typeorm';
import { dataSourceOptions } from '../database/data-source';
import { LoginAttempt } from '../modules/auth/entities/login-attempt.entity';

async function fixLoginAttemptForeignKey() {
  console.log('Starting fix-login-attempt-fk script...');

  try {
    // Connect to the database
    const connection = await createConnection({
      ...dataSourceOptions,
      entities: [...(dataSourceOptions.entities as any[]), LoginAttempt], // Add LoginAttempt to entities
      synchronize: false, // Disable auto-synchronization
      migrationsRun: false, // Disable auto-migration
    });

    // Create query runner for transaction
    const queryRunner = connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log('Checking existing foreign key constraint...');

      // Drop existing foreign key if it exists (using SQLite syntax)
      // SQLite doesn't support direct "DROP CONSTRAINT" so we need a different approach
      // First check if the constraint exists in the sqlite_master table
      const constraintCheck = await queryRunner.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='login_attempt'
      `);

      if (constraintCheck.length > 0) {
        console.log('Login attempt table exists, proceeding with fix');

        // In SQLite, to modify constraints we need to:
        // 1. Create a new table with the correct structure
        // 2. Copy data from old table to new table
        // 3. Drop old table
        // 4. Rename new table to original name

        // Create temporary table
        await queryRunner.query(`
          CREATE TABLE "login_attempt_new" (
            "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            "ipAddress" text NOT NULL,
            "userAgent" text NOT NULL,
            "email" text,
            "status" text DEFAULT ('failed') NOT NULL,
            "userId" integer,
            "failureReason" text,
            "metadata" text,
            "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL
          )
        `);

        // Copy data from old table to new table
        await queryRunner.query(`
          INSERT INTO "login_attempt_new" ("id", "ipAddress", "userAgent", "email", "status", "userId", "failureReason", "metadata", "createdAt")
          SELECT "id", "ipAddress", "userAgent", "email", "status", "userId", "failureReason", "metadata", "createdAt" FROM "login_attempt"
        `);

        // Drop old table
        await queryRunner.query(`DROP TABLE "login_attempt"`);

        // Rename new table to original name
        await queryRunner.query(
          `ALTER TABLE "login_attempt_new" RENAME TO "login_attempt"`,
        );

        console.log('Foreign key constraint has been fixed successfully!');
      } else {
        console.log('Login attempt table not found, no action taken');
      }

      // Commit transaction
      await queryRunner.commitTransaction();
      console.log('Transaction committed successfully');
    } catch (error) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      console.error('Error fixing foreign key constraint:', error);
      throw error;
    } finally {
      // Release query runner
      await queryRunner.release();
    }

    // Close connection
    await connection.close();
    console.log('Database connection closed');
    console.log('Fix script completed successfully');
  } catch (error) {
    console.error('Error connecting to database:', error);
    process.exit(1);
  }
}

// Run the function
fixLoginAttemptForeignKey()
  .then(() => {
    console.log('Foreign key fix completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error running fix script:', error);
    process.exit(1);
  });
