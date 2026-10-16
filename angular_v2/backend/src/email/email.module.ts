import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { DatabasePoolModule } from '../common/database-pool.module.js';
import { EmailAuditWriter } from './email-audit.writer.js';
import { EmailService } from './email.service.js';
import { EMAIL_PROVIDER } from './email.provider.js';
import { EmailRenderer } from './email.renderer.js';
import { NodemailerEmailProvider } from './nodemailer-email.provider.js';

/**
 * One provider mechanism, registered once, behind a `Symbol` token
 * (`AGENTS.md` §2.4 and §B7). Not `@Global()`: a module that is imported
 * explicitly by the one feature that needs it is easier to read than one every
 * feature can reach, and `AuthModule` is currently the only consumer.
 *
 * The renderer is a factory rather than an `@Injectable` class because it takes
 * a `URL` — a template directory it reads itself — and DI cannot supply one.
 * That same constructor is how the build assertion renders from `dist/`
 * instead of from `src/`.
 *
 * Nothing here registers a stand-in. The provider is always the real one, and
 * it always speaks the same transport; what configuration changes between
 * environments is the destination it speaks to, never the mechanism
 * (ADR-0024).
 */
@Module({
  imports: [ConfigModule, DatabasePoolModule],
  providers: [
    { provide: EmailRenderer, useFactory: () => new EmailRenderer() },
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): NodemailerEmailProvider =>
        new NodemailerEmailProvider(config.getOrThrow<Environment>('environment').email),
    },
    EmailAuditWriter,
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}