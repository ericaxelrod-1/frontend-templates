import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CacheSyncService } from '../modules/cache/cache-sync.service';

/**
 * Script to synchronize permissions cache
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    console.log('Starting permission cache synchronization...');

    const cacheSyncService = app.get(CacheSyncService);

    console.log('Syncing all permissions to cache...');
    await cacheSyncService.syncAllPermissions();

    console.log('Permission cache synchronization completed successfully!');
  } catch (error) {
    console.error('Error during cache synchronization:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

// Run the script
bootstrap();
