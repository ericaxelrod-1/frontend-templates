import { createConnection } from 'typeorm';
import { dataSourceOptions } from '../database/data-source';
import { LoginAttempt } from '../modules/auth/entities/login-attempt.entity';
import { User } from '../modules/users/entities/user.entity';

async function createTestLoginAttempt() {
  console.log('Starting create-test-login-attempt script...');

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
      // Find first user
      const userRepository = connection.getRepository(User);
      const users = await userRepository.find({ take: 1 });

      if (users.length === 0) {
        console.log('No users found in the database, creating a test user...');

        // Create a test user if none exists
        const user = userRepository.create({
          username: 'testuser',
          email: 'testuser@example.com',
          password: 'hashed_password_here',
          isActive: true,
          emailVerified: true,
        });

        await userRepository.save(user);
        console.log(`Created test user with ID: ${user.id}`);

        // Create login attempt for this user
        await createLoginAttemptForUser(connection, user);
      } else {
        const user = users[0];
        console.log(
          `Found existing user with ID: ${user.id}, email: ${user.email}`,
        );

        // Create login attempt for this user
        await createLoginAttemptForUser(connection, user);
      }

      // Commit transaction
      await queryRunner.commitTransaction();
      console.log('Transaction committed successfully');
    } catch (error) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      console.error('Error creating test login attempt:', error);
      throw error;
    } finally {
      // Release query runner
      await queryRunner.release();
    }

    // Test loading login attempt with user relation
    console.log('\nTesting relationship loading...');

    const loginAttemptRepository = connection.getRepository(LoginAttempt);
    const loginAttemptsWithUser = await loginAttemptRepository.find({
      relations: ['user'],
      take: 1,
      order: { attemptedAt: 'DESC' },
    });

    if (loginAttemptsWithUser.length > 0) {
      const attempt = loginAttemptsWithUser[0];
      console.log(
        `Latest login attempt: ID=${attempt.id}, ipAddress=${attempt.ipAddress}`,
      );

      if (attempt.user) {
        console.log('✅ SUCCESS: User relationship loaded correctly');
        console.log(`  User ID: ${attempt.user.id}`);
        console.log(`  User email: ${attempt.user.email}`);
      } else {
        console.log('❌ ERROR: User relationship not loaded');
      }
    } else {
      console.log('No login attempts found');
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

// Helper function to create a login attempt for a specific user
async function createLoginAttemptForUser(connection: any, user: User) {
  const loginAttemptRepository = connection.getRepository(LoginAttempt);

  // Create a successful login attempt
  const loginAttempt = loginAttemptRepository.create({
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 Test Browser',
    emailAttempted: user.email,
    status: 'success',
    user: user,
    metadata: JSON.stringify({
      browser: 'Test Browser',
      os: 'Test OS',
      device: 'Test Device',
    }),
  });

  const savedAttempt = await loginAttemptRepository.save(loginAttempt);
  console.log(`Created login attempt with ID: ${savedAttempt.id}`);
  return savedAttempt;
}

// Run the function
createTestLoginAttempt()
  .then(() => {
    console.log('Test login attempt created successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error running script:', error);
    process.exit(1);
  });
