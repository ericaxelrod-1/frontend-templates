import { Module, Global, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { EmailProvider } from './email.provider.interface';

const EMAIL_PROVIDER_TOKEN = 'EmailProvider';

const emailProvider: Provider = {
  provide: EMAIL_PROVIDER_TOKEN,
  useClass: NodemailerEmailProvider,
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [emailProvider, EmailService],
  exports: [EmailService, EMAIL_PROVIDER_TOKEN],
})
export class EmailModule {}
