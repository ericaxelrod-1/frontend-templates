import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  debug: true,
  mockBackend: false,
  logLevel: 'debug',
  tokenLifespan: 3600, // 1 hour
  refreshTokenLifespan: 604800, // 7 days
  authTokenKey: 'auth_token',
  refreshTokenKey: 'refresh_token',
  hmr: false,
  logging: {
    enabled: true,
    logLevel: 'debug',
    logToConsole: true,
    logToFile: true,
    colorize: true,
    timestampFormat: 'ISO'
  },
  auth: {
    jwtExpirationTime: 3600, // 1 hour
    refreshTokenExpirationTime: 604800, // 7 days
    loginAttempts: 3,
    lockoutTime: 300 // 5 minutes
  },
  captcha: {
    enabled: true, // Re-enabled for proper security
    difficulty: 'easy', // Set to easy for development
    skipForDevelopment: false // Show CAPTCHA in development mode for testing
  },
  privacy: {
    verificationWindowHours: 24 // 24 hours before unverified privacy requests expire
  },
  debugMode: true
}; 