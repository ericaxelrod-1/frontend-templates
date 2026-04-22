import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EmailService } from '../modules/email/email.service';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Gmail Delivery Test Script
 * 
 * This script bootstraps the NestJS application context, loads the .env.gmail file,
 * and sends a real email using the Gmail SMTP provider.
 */
async function bootstrap() {
  const envPath = path.resolve(process.cwd(), '.env.gmail');
  
  if (!fs.existsSync(envPath)) {
    console.error('\x1b[31m%s\x1b[0m', 'Error: .env.gmail file not found!');
    console.log('Please run: cp env.gmail.example .env.gmail and fill in your credentials.');
    process.exit(1);
  }

  console.log(`Loading environment from: ${envPath}`);
  dotenv.config({ path: envPath });

  // Ensure EMAIL_ENABLED is true for this script regardless of .env settings
  process.env.EMAIL_ENABLED = 'true';

  console.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const emailService = app.get(EmailService);
  const targetEmail = process.argv[2] || process.env.EMAIL_USER;

  if (!targetEmail) {
    console.error('\x1b[31m%s\x1b[0m', 'Error: No target email specified.');
    console.log('Usage: npm run test:gmail <your-email@gmail.com>');
    await app.close();
    process.exit(1);
  }

  console.log(`\n--- Real-World Delivery Test ---`);
  console.log(`From: ${process.env.EMAIL_FROM}`);
  console.log(`To:   ${targetEmail}`);
  console.log(`Host: ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT}`);
  console.log(`-------------------------------\n`);

  try {
    console.log('Sending Test Verification Email...');
    const result = await emailService.sendVerificationEmail(
      targetEmail,
      'REAL-GMAIL-TOKEN-123456',
      'Gmail Test User'
    );

    if (result) {
      console.log('\x1b[32m%s\x1b[0m', '\nSUCCESS: Email sent successfully!');
      console.log('Please check your inbox (and spam folder) in a few seconds.');
    } else {
      console.error('\x1b[31m%s\x1b[0m', '\nFAILURE: Email service returned false.');
    }
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '\nCRITICAL ERROR:');
    console.error(error);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
