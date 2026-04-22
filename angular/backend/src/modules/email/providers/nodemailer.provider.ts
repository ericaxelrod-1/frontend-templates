import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import {
  EmailProvider,
  SendEmailOptions,
  SendEmailResult,
} from '../email.provider.interface';

@Injectable()
export class NodemailerEmailProvider implements EmailProvider {
  private readonly logger = new Logger(NodemailerEmailProvider.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const transport = this.configService.get('email.transport');
    const defaults = this.configService.get('email.defaults');

    if (!transport) {
      this.logger.warn(
        'Email transport not configured. Emails will not be sent.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport(transport, defaults);
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      if (!this.transporter) {
        return { success: false, error: 'Email not configured' };
      }

      let html = options.html;
      if (options.template && options.context) {
        html = this.renderTemplate(options.template, options.context);
      }

      const info = await this.transporter.sendMail({
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: html,
      });

      this.logger.log(`Email sent to ${options.to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${options.to}: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }

  private renderTemplate(
    templateName: string,
    context: Record<string, any>,
  ): string {
    const templatePath = path.join(
      __dirname,
      'templates',
      `${templateName}.html`,
    );

    try {
      let content = fs.readFileSync(templatePath, 'utf8');

      // Simple template replacement: {{variableName}}
      for (const [key, value] of Object.entries(context)) {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
        content = content.replace(regex, this.sanitize(String(value)));
      }

      return content;
    } catch (error) {
      this.logger.error(
        `Failed to load template ${templateName}: ${error.message}`,
      );
      return `<p>Email template error: ${templateName}</p>`;
    }
  }

  private sanitize(value: string): string {
    return value
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  getProviderName(): string {
    return 'nodemailer';
  }
}
