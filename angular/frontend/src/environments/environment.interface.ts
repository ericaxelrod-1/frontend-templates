export interface Environment {
  production: boolean;
  apiUrl: string;
  debug: boolean;
  mockBackend: boolean;
  logLevel: string;
  tokenLifespan: number;
  refreshTokenLifespan: number;
  authTokenKey: string;
  refreshTokenKey: string;
  hmr: boolean;
  logging: {
    enabled: boolean;
    logLevel: string;
    logToConsole: boolean;
    logToFile: boolean;
    colorize: boolean;
    timestampFormat: string;
  };
  auth: {
    jwtExpirationTime: number;
    refreshTokenExpirationTime: number;
    loginAttempts: number;
    lockoutTime: number;
  };
  captcha: {
    enabled: boolean;
    difficulty: 'easy' | 'medium' | 'hard';
    skipForDevelopment?: boolean;
  };
  privacy: {
    verificationWindowHours: number;
  };
  debugMode: boolean;
} 