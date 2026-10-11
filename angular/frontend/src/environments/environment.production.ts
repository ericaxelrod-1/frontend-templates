import { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  apiUrl: 'http://localhost:3000/api', // Resolved API path
  debug: false,
  mockBackend: false,
  logLevel: 'error',
  tokenLifespan: 3600, // 1 hour
  refreshTokenLifespan: 604800, // 7 days
  authTokenKey: 'auth_token',
  refreshTokenKey: 'refresh_token',
  hmr: false,
  logging: {
    enabled: false,
    logLevel: 'error',
    logToConsole: false,
    logToFile: true,
    colorize: false,
    timestampFormat: 'ISO'
  },
  auth: {
    jwtExpirationTime: 3600, // 1 hour
    refreshTokenExpirationTime: 604800, // 7 days
    loginAttempts: 3,
    lockoutTime: 300 // 5 minutes
  },
  captcha: {
    enabled: true,
    difficulty: 'hard'
  },
  privacy: {
    verificationWindowHours: 24 // 24 hours before unverified privacy requests expire
  },
  debugMode: false
}; 