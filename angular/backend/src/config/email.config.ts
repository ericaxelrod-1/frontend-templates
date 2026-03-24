import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  enabled: process.env.EMAIL_ENABLED === 'true',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  provider: process.env.EMAIL_PROVIDER || 'nodemailer',
  transport: {
    host: process.env.EMAIL_HOST || '127.0.0.1',
    port: parseInt(process.env.EMAIL_PORT || '1025', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: process.env.EMAIL_USER
      ? {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        }
      : undefined,
  },
  defaults: {
    from: process.env.EMAIL_FROM || '"Angular App" <no-reply@example.com>',
  },
}));
