export const environment = {
  production: true,
  apiUrl: 'http://localhost:3000/api', // This should be updated to the production API URL
  hmr: false,
  logging: {
    enabled: true,
    logToConsole: false,
    logToFile: true,
    logLevel: 'error',
    logDir: 'logs'
  }
}; 