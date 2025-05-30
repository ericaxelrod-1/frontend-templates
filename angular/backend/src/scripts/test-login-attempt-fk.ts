import { createConnection } from 'typeorm';
import { dataSourceOptions } from '../database/data-source';
import { LoginAttempt } from '../modules/auth/entities/login-attempt.entity';
import { User } from '../modules/users/entities/user.entity';

async function testLoginAttemptForeignKey() {
  console.log('Starting test-login-attempt-fk script...');

  try {
    // Connect to the database
    const connection = await createConnection({
      ...dataSourceOptions,
      entities: [...(dataSourceOptions.entities as any[]), LoginAttempt], // Add LoginAttempt to entities
      synchronize: false, // Disable auto-synchronization
      migrationsRun: false, // Disable auto-migration
    });

    // Create query runner
    const queryRunner = connection.createQueryRunner();
    await queryRunner.connect();

    try {
      console.log('Checking login_attempt table schema...');

      // Get table schema from SQLite
      const tableInfo = await queryRunner.query(
        `PRAGMA table_info(login_attempt)`,
      );
      console.log('Table info:', tableInfo);

      // Get foreign key info
      const fkInfo = await queryRunner.query(
        `PRAGMA foreign_key_list(login_attempt)`,
      );
      console.log('Foreign key info:', fkInfo);

      if (fkInfo.length > 0) {
        console.log('Foreign key constraints found:');
        fkInfo.forEach((fk: any) => {
          console.log(
            ` - Column "${fk.from}" references "${fk.table}"."${fk.to}"`,
          );
        });

        // Check if userId references users.id correctly
        const userIdFk = fkInfo.find(
          (fk: any) =>
            fk.from === 'userId' && fk.table === 'users' && fk.to === 'id',
        );

        if (userIdFk) {
          console.log(
            '✅ SUCCESS: Foreign key constraint is correctly set between login_attempt.userId and users.id',
          );
        } else {
          console.log('❌ ERROR: Foreign key constraint is not correctly set!');
        }
      } else {
        console.log(
          '❌ ERROR: No foreign key constraints found on login_attempt table!',
        );
      }

      // Test functionality by checking users and login_attempts
      console.log('\nTesting basic functionality...');

      // Get first user
      const users = await connection.getRepository(User).find({
        take: 1,
      });
      console.log(`Found ${users.length} users`);

      if (users.length > 0) {
        const user = users[0];
        console.log(`Test user: id=${user.id}, email=${user.email}`);

        // Get login attempts for this user
        const loginAttempts = await connection
          .getRepository(LoginAttempt)
          .find({
            where: { userId: user.id },
          });
        console.log(
          `Found ${loginAttempts.length} login attempts for user ${user.id}`,
        );

        // Test relationship loading
        const loginAttemptsWithUser = await connection
          .getRepository(LoginAttempt)
          .find({
            where: { userId: user.id },
            relations: ['user'],
          });

        if (loginAttemptsWithUser.length > 0) {
          const attempt = loginAttemptsWithUser[0];
          if (attempt.user && attempt.user.id === user.id) {
            console.log('✅ SUCCESS: Relationship loading works correctly');
          } else {
            console.log(
              '❌ ERROR: Relationship loading failed or returned incorrect user',
            );
          }
        } else {
          console.log(
            '⚠️ WARNING: No login attempts found for this user to test relationship loading',
          );
        }
      } else {
        console.log('⚠️ WARNING: No users found to test with');
      }
    } catch (error) {
      console.error('Error testing foreign key constraint:', error);
      throw error;
    } finally {
      // Release query runner
      await queryRunner.release();
    }

    // Close connection
    await connection.close();
    console.log('Database connection closed');
    console.log('Test script completed successfully');
  } catch (error) {
    console.error('Error connecting to database:', error);
    process.exit(1);
  }
}

// Run the function
testLoginAttemptForeignKey()
  .then(() => {
    console.log('Foreign key test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error running test script:', error);
    process.exit(1);
  });
