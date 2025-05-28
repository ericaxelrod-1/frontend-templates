import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DetectedPattern } from './pattern-detection.service';

export enum AlertChannel {
  CONSOLE = 'console',
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  DATABASE = 'database',
  SMS = 'sms',
}

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  timestamp: Date;
  ipAddress?: string;
  userId?: number;
  email?: string;
  data?: any;
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly channels: AlertChannel[];
  private readonly thresholdSeverity: AlertSeverity;
  private readonly emailConfig: {
    recipients: string[];
    from: string;
  };
  private readonly webhookConfig: {
    url: string;
    headers: Record<string, string>;
  };

  constructor(private readonly configService: ConfigService) {
    // Load configuration
    this.channels = this.configService.get<AlertChannel[]>('alerts.channels', [
      AlertChannel.CONSOLE,
    ]);
    this.thresholdSeverity = this.configService.get<AlertSeverity>(
      'alerts.thresholdSeverity',
      AlertSeverity.MEDIUM,
    );

    this.emailConfig = {
      recipients: this.configService.get<string[]>(
        'alerts.email.recipients',
        [],
      ),
      from: this.configService.get<string>(
        'alerts.email.from',
        'security@example.com',
      ),
    };

    this.webhookConfig = {
      url: this.configService.get<string>('alerts.webhook.url', ''),
      headers: this.configService.get<Record<string, string>>(
        'alerts.webhook.headers',
        {},
      ),
    };
  }

  /**
   * Send an alert based on a detected pattern
   */
  async sendPatternAlert(pattern: DetectedPattern): Promise<boolean> {
    const alert: AlertPayload = {
      title: `Security Alert: ${this.formatPatternType(pattern.type)}`,
      message: pattern.details,
      severity: pattern.severity as AlertSeverity,
      timestamp: pattern.timestamp,
      ipAddress: pattern.ipAddress,
      userId: pattern.userId,
      data: pattern.evidence,
    };

    return this.sendAlert(alert);
  }

  /**
   * Send an alert with custom data
   */
  async sendAlert(alert: AlertPayload): Promise<boolean> {
    // Check severity threshold
    if (!this.meetsSeverityThreshold(alert.severity)) {
      this.logger.debug(`Alert suppressed (below threshold): ${alert.title}`);
      return false;
    }

    // Send to all configured channels
    const results = await Promise.all(
      this.channels.map((channel) => this.sendToChannel(channel, alert)),
    );

    // Return true if at least one channel succeeded
    return results.some(Boolean);
  }

  /**
   * Check if the severity meets the threshold
   */
  private meetsSeverityThreshold(severity: AlertSeverity): boolean {
    const severityValues = {
      [AlertSeverity.LOW]: 0,
      [AlertSeverity.MEDIUM]: 1,
      [AlertSeverity.HIGH]: 2,
      [AlertSeverity.CRITICAL]: 3,
    };

    return severityValues[severity] >= severityValues[this.thresholdSeverity];
  }

  /**
   * Send an alert to a specific channel
   */
  private async sendToChannel(
    channel: AlertChannel,
    alert: AlertPayload,
  ): Promise<boolean> {
    try {
      switch (channel) {
        case AlertChannel.CONSOLE:
          return this.sendConsoleAlert(alert);
        case AlertChannel.EMAIL:
          return this.sendEmailAlert(alert);
        case AlertChannel.WEBHOOK:
          return this.sendWebhookAlert(alert);
        case AlertChannel.DATABASE:
          return this.sendDatabaseAlert(alert);
        case AlertChannel.SMS:
          return this.sendSmsAlert(alert);
        default:
          this.logger.warn(`Unknown alert channel: ${channel}`);
          return false;
      }
    } catch (error) {
      this.logger.error(
        `Failed to send alert to ${channel}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Log the alert to the console
   */
  private sendConsoleAlert(alert: AlertPayload): boolean {
    const severityTag = this.getSeverityTag(alert.severity);
    const message = `${severityTag} ${alert.title}: ${alert.message}`;

    switch (alert.severity) {
      case AlertSeverity.CRITICAL:
      case AlertSeverity.HIGH:
        this.logger.error(message);
        break;
      case AlertSeverity.MEDIUM:
        this.logger.warn(message);
        break;
      case AlertSeverity.LOW:
      default:
        this.logger.log(message);
        break;
    }

    return true;
  }

  /**
   * Send an email alert
   */
  private async sendEmailAlert(alert: AlertPayload): Promise<boolean> {
    if (!this.emailConfig.recipients.length) {
      this.logger.warn('No email recipients configured for alerts');
      return false;
    }

    // In a real implementation, this would use a proper email sending service
    // For now, we'll just log that we would send an email
    const severityTag = this.getSeverityTag(alert.severity);
    this.logger.log(
      `[EMAIL ALERT] Would send email to ${this.emailConfig.recipients.join(', ')}:`,
    );
    this.logger.log(`  From: ${this.emailConfig.from}`);
    this.logger.log(`  Subject: ${severityTag} ${alert.title}`);
    this.logger.log(`  Body: ${alert.message}`);

    if (alert.ipAddress) {
      this.logger.log(`  IP: ${alert.ipAddress}`);
    }

    if (alert.userId) {
      this.logger.log(`  User ID: ${alert.userId}`);
    }

    return true;
  }

  /**
   * Send a webhook alert
   */
  private async sendWebhookAlert(alert: AlertPayload): Promise<boolean> {
    if (!this.webhookConfig.url) {
      this.logger.warn('No webhook URL configured for alerts');
      return false;
    }

    // In a real implementation, this would make an HTTP request
    // For now, we'll just log that we would send a webhook
    this.logger.log(
      `[WEBHOOK ALERT] Would send webhook to ${this.webhookConfig.url}:`,
    );
    this.logger.log(`  Headers: ${JSON.stringify(this.webhookConfig.headers)}`);
    this.logger.log(
      `  Payload: ${JSON.stringify(
        {
          title: alert.title,
          message: alert.message,
          severity: alert.severity,
          timestamp: alert.timestamp,
          ipAddress: alert.ipAddress,
          userId: alert.userId,
          data: alert.data,
        },
        null,
        2,
      )}`,
    );

    return true;
  }

  /**
   * Store the alert in the database
   */
  private async sendDatabaseAlert(alert: AlertPayload): Promise<boolean> {
    // In a real implementation, this would store the alert in a database
    // For now, we'll just log that we would store an alert
    this.logger.log(
      `[DATABASE ALERT] Would store alert in database: ${alert.title}`,
    );
    return true;
  }

  /**
   * Send an SMS alert
   */
  private async sendSmsAlert(alert: AlertPayload): Promise<boolean> {
    // In a real implementation, this would send an SMS via a service like Twilio
    // For now, we'll just log that we would send an SMS
    this.logger.log(
      `[SMS ALERT] Would send SMS: ${alert.title} - ${alert.message}`,
    );
    return true;
  }

  /**
   * Get a tag for the severity level
   */
  private getSeverityTag(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return '[CRITICAL]';
      case AlertSeverity.HIGH:
        return '[HIGH]';
      case AlertSeverity.MEDIUM:
        return '[MEDIUM]';
      case AlertSeverity.LOW:
        return '[LOW]';
      default:
        return '[INFO]';
    }
  }

  /**
   * Format a pattern type for display
   */
  private formatPatternType(type: string): string {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}
