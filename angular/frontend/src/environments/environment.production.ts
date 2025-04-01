import { Environment } from './environment.interface';

export const environment: Environment = {
  production: true,
  apiUrl: 'http://localhost:3000/api', // This should be updated to the production API URL
  hmr: false,
  logging: {
    enabled: true,
    logToConsole: false,
    logToFile: true,
    logLevel: 'error',
    logDir: 'logs'
  },
  recaptcha: {
    siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', // This should be replaced with a production reCAPTCHA key
    enabled: true
  }
}; 