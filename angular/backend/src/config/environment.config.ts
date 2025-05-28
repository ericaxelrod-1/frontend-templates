import { registerAs } from '@nestjs/config';
import * as path from 'path';

export default registerAs('environment', () => {
  // Determine frontend path relative to the backend src directory
  const frontendPath = path.resolve(__dirname, '../../../frontend');

  return {
    // Frontend path for permission scanning
    FRONTEND_PATH: process.env.FRONTEND_PATH || frontendPath,

    // Environment settings
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Server settings
    PORT: parseInt(process.env.PORT, 10) || 3000,
    HOST: process.env.HOST || 'localhost',

    // API settings
    API_PREFIX: process.env.API_PREFIX || 'api',
    API_VERSION: process.env.API_VERSION || 'v1',

    // Security settings
    CORS_ENABLED: process.env.CORS_ENABLED === 'true',

    // Other settings that might be useful
    isDevelopment: process.env.NODE_ENV !== 'production',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test',
  };
});
