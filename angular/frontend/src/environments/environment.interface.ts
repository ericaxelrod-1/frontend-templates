export interface Environment {
  production: boolean;
  apiUrl: string;
  hmr: boolean;
  logging: {
    enabled: boolean;
    logToConsole: boolean;
    logToFile: boolean;
    logLevel: string;
    logDir: string;
  };
  recaptcha?: {
    siteKey: string;
    enabled: boolean;
  };
} 