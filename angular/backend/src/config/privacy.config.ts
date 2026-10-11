import { registerAs } from '@nestjs/config';

export default registerAs('privacy', () => ({
  verificationWindowHours: parseInt(process.env.PRIVACY_VERIFICATION_WINDOW_HOURS || '24', 10),
}));