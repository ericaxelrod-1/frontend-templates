export interface Environment {
  production: boolean;
  apiUrl: string;
  hmr: boolean;
  logging: {
    enabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
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
  };
  debugMode: boolean;
} 