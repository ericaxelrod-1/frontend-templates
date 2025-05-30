import { config } from 'dotenv';

// Load environment variables from .env.test file
config({ path: '.env.test' });

// Increase timeout for all tests
jest.setTimeout(30000);

// Clean up after all tests
afterAll(async () => {
  // Add any global cleanup here if needed
});
