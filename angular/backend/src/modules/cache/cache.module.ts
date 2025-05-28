import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { CacheSyncService } from './cache-sync.service';

@Module({
  providers: [CacheService, CacheSyncService],
  exports: [CacheService, CacheSyncService],
})
export class CacheModule {}
