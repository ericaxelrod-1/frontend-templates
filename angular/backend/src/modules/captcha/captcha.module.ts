import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaptchaController } from './captcha.controller';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [CaptchaController],
  providers: [],
  exports: [],
})
export class CaptchaModule {}
