import { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  apiUrl: '/api', // Will be replaced with actual production API URL
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
  debugMode: false
}; 