import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailConfig } from '../config/environment.js';
import type { EmailMessage, EmailProvider, SentEmail } from './email.provider.js';

/**
 * The only field this provider reads from nodemailer's result. The bundled types
 * declare `SentMessageInfo` as `any`, so the transporter is parameterised with
 * this instead: reading a field off an `any` is what the lint baseline's
 * `no-unsafe-member-access` exists to prevent, and this keeps the boundary
 * typed rather than laundering it.
 */
type DeliveryInfo = {
  readonly messageId: string;
};

/**
 * The one provider implementation, and the one transport.
 *
 * `createTransporter` below has **no branch of any kind**: every mode builds
 * nodemailer's `smtpTransport` from the same `EmailConfig.smtp`, and the only
 * thing that differs between development, test and production is the
 * *destination* — `EMAIL_HOST` and `EMAIL_PORT`. That is what makes dev and test
 * exercise the code path production runs: a real socket, a real EHLO, a real
 * `DATA`, a real `250`. The previous tree selected one of three transports by
 * the runtime mode, so no mode but production had ever spoken to a server
 * (`docs/adr.md` ADR-0024).
 *
 * `test/unit/email/email-config.spec.ts` asserts the absence of the branch
 * structurally — no mode conditional, no other transport name anywhere in
 * `src/email` — rather than trusting this comment.
 *
 * **What may be logged.** Recipient, subject, destination and message id —
 * metadata, never a body and never a token. There is no longer a transport that
 * writes the rendered message anywhere: the previous development transport
 * logged the whole MIME at `debug`, which meant a verification token in the log
 * of any process that was not production, and a rule that had to be argued
 * rather than read off the code.
 */
@Injectable()
export class NodemailerEmailProvider implements EmailProvider {
  private readonly logger = new Logger(NodemailerEmailProvider.name);
  private readonly transporter: Transporter<DeliveryInfo>;

  constructor(private readonly config: EmailConfig) {
    const { smtp } = config;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user === null ? undefined : { user: smtp.user, pass: smtp.password ?? '' },
      tls: { rejectUnauthorized: smtp.rejectUnauthorized },
    });
  }

  get name(): string {
    return 'nodemailer';
  }

  async send(message: EmailMessage): Promise<SentEmail> {
    const info = await this.transporter.sendMail({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      from: this.config.from,
    });

    const messageId = typeof info.messageId === 'string' ? info.messageId : '';

    // Metadata only. The recipient is kept because it is the correlation key an
    // operator has, and the destination because it is the one thing that decides
    // where the mail went. Neither is a credential or a token.
    this.logger.log(
      `accepted "${message.subject}" for ${message.to} over smtp ${this.config.smtp.host}:${this.config.smtp.port} (messageId ${messageId === '' ? 'none' : messageId})`,
    );

    return { messageId };
  }
}