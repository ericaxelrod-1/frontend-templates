import { NestFactory } from '@nestjs/core';
import { SeedModule } from './seed.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('SeedScript');
  logger.log('Starting seed process...');

  try {
    const app = await NestFactory.createApplicationContext(SeedModule);
    await app.init();

    // The SeedModule's onModuleInit will handle seeding
    logger.log('Seed process completed');
  } catch (error) {
    logger.error('Seed process failed:', error);
    process.exit(1);
  }
}

bootstrap();
