import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, SendEmailOptions } from './email.provider.interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject('EmailProvider') private emailProvider: EmailProvider,
    private configService: ConfigService,
  ) {}

  async sendVerificationEmail(
    email: string,
    token: string,
    userName: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Verify Your Email Address',
      template: 'verify-email',
      context: this.addGlobalContext({
        userName,
        verificationUrl: verifyUrl,
        token,
        expiresIn: '24 hours',
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send verification email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }

  async sendPasswordResetEmail(
    email: string,
    token: string,
    userName: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Password Reset Request',
      template: 'password-reset',
      context: this.addGlobalContext({
        userName,
        resetUrl,
        token,
        expiresIn: '1 hour',
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send password reset email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }

  async sendWelcomeEmail(email: string, userName: string): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const loginUrl = `${frontendUrl}/login`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Welcome to the Application',
      template: 'welcome-email',
      context: this.addGlobalContext({
        userName,
        loginUrl,
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send welcome email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }

  async sendGenericEmail(
    to: string,
    subject: string,
    template: string,
    context: Record<string, any>,
  ): Promise<boolean> {
    const result = await this.emailProvider.sendEmail({
      to,
      subject,
      template,
      context: this.addGlobalContext(context),
    });
    return result.success;
  }

  private addGlobalContext(context: Record<string, any>): Record<string, any> {
    return {
      appName: this.configService.get('email.appName', 'Angular App'),
      currentYear: new Date().getFullYear().toString(),
      ...context,
    };
  }

  // Privacy Ticket Email Methods
  async sendTicketSubmittedEmail(
    email: string,
    userName: string,
    ticketId: string,
    ticketType: string,
    ticketPriority: 'low' | 'medium' | 'high',
    submittedAt: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const ticketUrl = `${frontendUrl}/privacy-tickets/${ticketId}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Privacy Ticket Submitted - Request Received',
      template: 'ticket-submitted',
      context: this.addGlobalContext({
        userName,
        ticketId,
        ticketType,
        ticketPriority,
        submittedAt,
        ticketUrl,
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send ticket submitted email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }

  async sendTicketAssignedEmail(
    email: string,
    userName: string,
    ticketId: string,
    assignedAt: string,
    agentName: string,
    agentEmail: string,
    agentExpertise: string,
    estimatedTimeframe: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const ticketUrl = `${frontendUrl}/privacy-tickets/${ticketId}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Privacy Ticket Assigned - Specialist Assigned',
      template: 'ticket-assigned',
      context: this.addGlobalContext({
        userName,
        ticketId,
        assignedAt,
        agentName,
        agentEmail,
        agentExpertise,
        ticketUrl,
        estimatedTimeframe,
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send ticket assigned email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }

  async sendSlaWarningEmail(
    email: string,
    userName: string,
    ticketId: string,
    slaDeadline: string,
    timeRemaining: string,
    slaMetric: string,
    ticketPriority: string,
    slaType: string,
    targetResolution: string,
    businessDays: string,
    supportEmail: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const ticketUrl = `${frontendUrl}/privacy-tickets/${ticketId}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'SLA Warning - Privacy Ticket Approaching Deadline',
      template: 'sla-warning',
      context: this.addGlobalContext({
        userName,
        ticketId,
        slaDeadline,
        timeRemaining,
        slaMetric,
        ticketPriority,
        slaType,
        targetResolution,
        businessDays,
        ticketUrl,
        supportEmail,
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send SLA warning email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }

  async sendTicketResolvedEmail(
    email: string,
    userName: string,
    ticketId: string,
    resolvedAt: string,
    processingTime: string,
    requestType: string,
    resolutionAction: string,
    complianceStatus: string,
    dataImpact: string,
    agentName: string,
    agentEmail: string,
    resolutionNotes: string,
    documents: Array<{ name: string; url: string; type: string; size: string }>,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const ticketUrl = `${frontendUrl}/privacy-tickets/${ticketId}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Privacy Ticket Resolved - Action Completed',
      template: 'ticket-resolved',
      context: this.addGlobalContext({
        userName,
        ticketId,
        resolvedAt,
        processingTime,
        requestType,
        resolutionAction,
        complianceStatus,
        dataImpact,
        agentName,
        agentEmail,
        resolutionNotes,
        documents,
        ticketUrl,
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send ticket resolved email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }

  async sendTicketRejectedEmail(
    email: string,
    userName: string,
    ticketId: string,
    rejectedAt: string,
    requestType: string,
    rejectionCategory: string,
    rejectionCode: string,
    rejectionReason: string,
    rejectionReference: string,
    appealDeadline: string,
    appealUrl: string,
    complianceEmail: string,
    policy1: string,
    policy2: string,
    regulation1: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get(
      'email.frontendUrl',
      'http://localhost:4200',
    );
    const ticketUrl = `${frontendUrl}/privacy-tickets/${ticketId}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Privacy Ticket Rejected - Action Required',
      template: 'ticket-rejected',
      context: this.addGlobalContext({
        userName,
        ticketId,
        rejectedAt,
        requestType,
        rejectionCategory,
        rejectionCode,
        rejectionReason,
        rejectionReference,
        appealDeadline,
        appealUrl,
        complianceEmail,
        policy1,
        policy2,
        regulation1,
        ticketUrl,
      }),
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send ticket rejected email to ${email}: ${result.error}`,
      );
    }
    return result.success;
  }
}
