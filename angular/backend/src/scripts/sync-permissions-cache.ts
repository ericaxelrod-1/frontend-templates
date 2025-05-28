import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { CacheSyncService } from '../modules/permissions/cache-sync.service';

/**
 * Script to manually trigger a full synchronization of the permissions cache.
 * This can be useful during development or after significant permission changes.
 *
 * Usage: npm run sync:permissions-cache
 */
async function bootstrap() {
  const logger = new Logger('SyncPermissionsCache');
  logger.log('Starting manual permissions cache synchronization...');

  try {
    // Create a standalone application
    const app = await NestFactory.createApplicationContext(AppModule);

    // Get the cache sync service
    const cacheSyncService = app.get(CacheSyncService);

    // Run the synchronization
    logger.log('Triggering cache synchronization...');
    await cacheSyncService.syncAll();
    logger.log('Cache synchronization completed successfully.');

    // Clean up
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error(`Cache synchronization failed: ${error.message}`, error.stack);
    process.exit(1);
  }
}

bootstrap();
