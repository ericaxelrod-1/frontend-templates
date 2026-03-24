import { registerAs } from '@nestjs/config';
import * as path from 'path';

export default registerAs('environment', () => {
  const frontendPath = path.resolve(__dirname, '../../../frontend');

  return {
    FRONTEND_PATH: process.env.FRONTEND_PATH || frontendPath,

    NODE_ENV: process.env.NODE_ENV || 'development',

    PORT: parseInt(process.env.PORT, 10) || 3000,
    HOST: process.env.HOST || 'localhost',

    API_PREFIX: process.env.API_PREFIX || 'api',
    API_VERSION: process.env.API_VERSION || 'v1',

    CORS_ENABLED: process.env.CORS_ENABLED === 'true',

    geoBlocking: {
      enabled: process.env.GEO_BLOCK_ENABLED === 'true',
      blockedCountries: process.env.GEO_BLOCK_COUNTRIES || '',
      blockedRegions: process.env.GEO_BLOCK_REGIONS || '',
    },

    isDevelopment: process.env.NODE_ENV !== 'production',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test',
  };
});
