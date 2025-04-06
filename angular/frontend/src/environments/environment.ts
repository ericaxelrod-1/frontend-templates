import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
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
    enabled: true,
    difficulty: 'medium'
  },
  debugMode: true
}; 