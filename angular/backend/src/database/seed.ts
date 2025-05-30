import { config } from 'dotenv';
import dataSource from './data-source';
import { seedDatabase as seedRoles } from './seeds/initial.seed';
import { seedUsers } from './seeds/users.seed';
import { seedGroups } from './seeds/groups.seed';

// Load environment variables
config();

async function main() {
  try {
    // Initialize data source
    console.log('Initializing database connection...');
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    console.log('Database connection established.');

    // Run all seed functions
    console.log('Seeding database...');

    // Seed roles first (required for foreign key constraints)
    await seedRoles(dataSource);

    // Seed users (needs roles first)
    await seedUsers(dataSource);

    // Seed groups (needs users first)
    await seedGroups(dataSource);

    console.log('Database seeding completed successfully!');

    // Close connection
    await dataSource.destroy();
    console.log('Database connection closed.');
  } catch (error) {
    console.error('Database seeding failed:', error);
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    process.exit(1);
  }
}

// Run the seed function if this script is executed directly
if (require.main === module) {
  main();
}

export default main;
