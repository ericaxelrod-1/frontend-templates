import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IPAllowlistService } from './services/ip-allowlist.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [IPAllowlistService],
  exports: [IPAllowlistService],
})
export class SharedModule {}
