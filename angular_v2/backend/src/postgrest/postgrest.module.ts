import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PostgrestClient } from './postgrest-client.js';

@Module({
  imports: [ConfigModule],
  providers: [PostgrestClient],
  exports: [PostgrestClient],
})
export class PostgrestModule {}
