import { NestFactory } from '@nestjs/core';
import { PrivacyModule } from '../privacy.module';
// Removed: import { PrivacyAuditService } from '../services/privacy-audit.service';
import * as crypto from 'crypto';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(PrivacyModule);
  // Removed: const auditService = app.get(PrivacyAuditService);

  console.log('--- Privacy HMAC Pepper Rotation Tool ---');
  
  const newPepper = crypto.randomBytes(32).toString('hex');
  const newKid = `v${Date.now()}`;

  console.log(`\nNew Pepper (KID: ${newKid}):`);
  console.log(newPepper);
  
  console.log('\n--- Instructions ---');
  console.log('1. Add the following to your .env file:');
  console.log(`   PRIVACY_PEPPER_${newKid}=${newPepper}`);
  console.log('2. Update your agent.yaml or config to include this KID in the active key ring.');
  console.log('3. Restart the backend to activate the new key.');
  
  await app.close();
}

bootstrap();
