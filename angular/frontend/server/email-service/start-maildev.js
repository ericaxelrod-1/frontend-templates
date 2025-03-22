/**
 * MailDev Server Starter
 * 
 * This script starts a MailDev server for capturing and viewing emails during development.
 * It's a simple wrapper around the MailDev library with our configuration.
 */

const MailDev = require('maildev');
const emailConfig = require('./config/email-config');

if (process.env.NODE_ENV === 'production') {
  console.error('Error: MailDev should not be started in production mode');
  process.exit(1);
}

// Create a new instance of MailDev using our configuration
const maildev = new MailDev({
  smtp: emailConfig.transport.port,
  web: emailConfig.mailDevUI.port,
  open: true, // Automatically open web UI
  disableWeb: false,
  silent: false,
  verbose: true
});

// Start the MailDev server
maildev.listen((err) => {
  if (err) {
    console.error('Error starting MailDev:', err);
    process.exit(1);
  }
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║                 MailDev Server Started                     ║
║                                                            ║
║  SMTP Server: localhost:${emailConfig.transport.port}                      ║
║  Web Interface: http://localhost:${emailConfig.mailDevUI.port}                 ║
║                                                            ║
║  All emails sent through the SMTP server will be captured  ║
║  and displayed in the web interface.                       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Handle errors
maildev.on('error', (err) => {
  console.error('MailDev Error:', err);
});

// Log new emails
maildev.on('new', (email) => {
  console.log(`New email received: "${email.subject}" from ${email.from[0].address} to ${email.to[0].address}`);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down MailDev server...');
  maildev.close(() => {
    console.log('MailDev server stopped');
    process.exit(0);
  });
}); 