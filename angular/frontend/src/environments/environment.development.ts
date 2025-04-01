import { Environment } from './environment.interface';

export const environment: Environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  hmr: false,
  logging: {
    enabled: true,
    logToConsole: true,
    logToFile: true,
    logLevel: 'debug',
    logDir: 'logs'
  },
  recaptcha: {
    siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', // reCAPTCHA test key
    enabled: true
  }
}; 