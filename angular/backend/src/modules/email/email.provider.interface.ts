export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
  getProviderName(): string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  template?: string;
  context?: Record<string, any>;
  text?: string;
  html?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
