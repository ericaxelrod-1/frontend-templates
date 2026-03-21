# Email Service Implementation Plan

## Current State Assessment

### Existing Frontend Email Service

**Location**: `angular/frontend/server/email-service/`

**What exists**:
- `email-service.js`: Node.js service using nodemailer
- `config/email-config.js`: Environment-based configuration
- `templates/password-reset.html`: Password reset template
- Separate server running on port 1025 (MailDev for dev)

**Key Methods**:
```javascript
sendEmail(options)           // Generic send
sendPasswordResetEmail(email, resetToken, resetUrl)  // Password reset
validateEmail(email)         // Validation
sanitizeContext(context)     // XSS prevention
renderTemplate(name, ctx)    // Template rendering
```

**NOTEs**:
- This is a SEPARATE server, not part of the backend
- No verification email functionality exists
- No welcome email functionality exists
- NOT integrated with NestJS backend

### Backend Auth Service - Where Emails Should Be Sent

**File**: `backend/src/modules/auth/auth.service.ts`

**Registration** (lines 399-408):
```typescript
// Current code just returns user, no email sent
// Comment says: "This would typically generate a token and send an email"
// We need to: Generate verification token, send verification email
```

**Password Reset** (lines 494-518):
```typescript
// Current code returns token directly for testing
// Comment says: "In a real application, you would send an email"
// We need to: Send password reset email with link
```

### User Entity Fields Already Exist

**File**: `backend/src/modules/users/entities/user.entity.ts`

```typescript
isEmailVerified: boolean;           // Line 46 - for verification
emailVerifiedAt: Date;             // Line 65 - timestamp
registrationVerificationSentAt: Date;  // Line 68 - for rate limiting
```

These fields exist but aren't being used by email sending.

---

## Design Decision: Where Should Email Service Run?

### Option A: Backend Own Email Service (RECOMMENDED)

Create a new NestJS email module in the backend that:
- Uses nodemailer directly (similar to frontend service)
- Can be easily swapped via provider abstraction
- Doesn't depend on frontend server
- Works independently of frontend deployment

**Advantages**:
- Decoupled from frontend
- Easier to deploy independently
- Consistent with backend architecture
- Can use same patterns as other services

**Disadvantages**:
- Duplicates some code from frontend service

### Option B: Reuse Frontend Email Service

Make backend HTTP calls to `frontend/server/email-service/`

**Advantages**:
- No code duplication

**Disadvantages**:
- Coupling between services
- Frontend must be running
- More complex error handling
- Inconsistent with backend architecture

---

## Implementation Plan

### Phase 1: Create Email Module in Backend

#### 1.1 Module Structure

```
backend/src/modules/email/
├── email.module.ts
├── email.service.ts
├── email.provider.interface.ts
├── providers/
│   ├── nodemailer.provider.ts
│   └── templates/
│       ├── verify-email.html
│       ├── password-reset.html
│       ├── welcome-email.html
│       └── base-layout.html
├── dto/
│   └── send-email.dto.ts
└── email.controller.ts (optional, for testing)
```

#### 1.2 Provider Interface

**File**: `backend/src/modules/email/email.provider.interface.ts`

```typescript
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
```

#### 1.3 Nodemailer Provider

**File**: `backend/src/modules/email/providers/nodemailer.provider.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, SendEmailOptions, SendEmailResult } from '../email.provider.interface';

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
      this.logger.warn('Email transport not configured. Emails will not be sent.');
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
      this.logger.error(`Failed to send email to ${options.to}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private renderTemplate(templateName: string, context: Record<string, any>): string {
    const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
    
    try {
      let content = fs.readFileSync(templatePath, 'utf8');
      
      // Simple template replacement: {{variableName}}
      for (const [key, value] of Object.entries(context)) {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
        content = content.replace(regex, this.sanitize(String(value)));
      }
      
      return content;
    } catch (error) {
      this.logger.error(`Failed to load template ${templateName}: ${error.message}`);
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
```

### Phase 2: Email Service

#### 2.1 Service with Typed Methods

**File**: `backend/src/modules/email/email.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, SendEmailOptions } from './email.provider.interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private emailProvider: EmailProvider,
    private configService: ConfigService,
  ) {}

  async sendVerificationEmail(
    email: string,
    token: string,
    userName: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get('email.frontendUrl', 'http://localhost:4200');
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Verify Your Email Address',
      template: 'verify-email',
      context: {
        userName,
        verificationUrl: verifyUrl,
        token,
        expiresIn: '24 hours',
      },
    });

    if (!result.success) {
      this.logger.error(`Failed to send verification email to ${email}: ${result.error}`);
    }
    return result.success;
  }

  async sendPasswordResetEmail(
    email: string,
    token: string,
    userName: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get('email.frontendUrl', 'http://localhost:4200');
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Password Reset Request',
      template: 'password-reset',
      context: {
        userName,
        resetUrl,
        token,
        expiresIn: '1 hour',
      },
    });

    if (!result.success) {
      this.logger.error(`Failed to send password reset email to ${email}: ${result.error}`);
    }
    return result.success;
  }

  async sendWelcomeEmail(
    email: string,
    userName: string,
  ): Promise<boolean> {
    const frontendUrl = this.configService.get('email.frontendUrl', 'http://localhost:4200');
    const loginUrl = `${frontendUrl}/login`;

    const result = await this.emailProvider.sendEmail({
      to: email,
      subject: 'Welcome to the Application',
      template: 'welcome-email',
      context: {
        userName,
        loginUrl,
      },
    });

    if (!result.success) {
      this.logger.error(`Failed to send welcome email to ${email}: ${result.error}`);
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
      context,
    });
    return result.success;
  }
}
```

### Phase 3: Module Configuration

#### 3.1 Email Configuration

**File**: `backend/src/config/email.config.ts`

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  enabled: process.env.EMAIL_ENABLED === 'true',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  provider: process.env.EMAIL_PROVIDER || 'nodemailer',
  transport: {
    host: process.env.EMAIL_HOST || '127.0.0.1',
    port: parseInt(process.env.EMAIL_PORT || '1025', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: process.env.EMAIL_USER ? {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    } : undefined,
  },
  defaults: {
    from: process.env.EMAIL_FROM || '"Angular App" <no-reply@example.com>',
  },
}));
```

#### 3.2 Register in App Module

**File**: `backend/src/app.module.ts`

```typescript
import emailConfig from './config/email.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [environmentConfig, databaseConfig, emailConfig],  // Add emailConfig
    }),
    // ... existing imports
  ],
})
export class AppModule {}
```

#### 3.3 Email Module

**File**: `backend/src/modules/email/email.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { EmailProvider } from './email.provider.interface';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EmailProvider,
      useClass: NodemailerEmailProvider,
    },
    EmailService,
  ],
  exports: [EmailService, EmailProvider],
})
export class EmailModule {}
```

### Phase 4: Integrate with Auth Service

#### 4.1 Update AuthService

**File**: `backend/src/modules/auth/auth.service.ts`

Inject EmailService:

```typescript
constructor(
  // ... existing dependencies
  private readonly emailService: EmailService,  // Add
) {}
```

**Registration method** - update to send verification email:

```typescript
async register(registerDto: RegisterDto): Promise<any> {
  // ... existing registration logic ...

  const savedUser = await this.userRepository.save(newUser);

  // Send verification email
  const verificationToken = this.jwtService.sign(
    { sub: savedUser.id, email: savedUser.email, type: 'email_verification' },
    { expiresIn: '24h' },
  );

  const userName = savedUser.firstName || savedUser.username;
  await this.emailService.sendVerificationEmail(
    savedUser.email,
    verificationToken,
    userName,
  );

  // Update timestamp
  await this.usersService.updateVerificationSentAt(savedUser.id);

  return {
    id: savedUser.id,
    email: savedUser.email,
    requiresEmailVerification: true,
  };
}
```

**Forgot Password method** - update to send reset email:

```typescript
async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ success: boolean; message: string }> {
  const { email } = forgotPasswordDto;

  const user = await this.usersService.findByEmail(email);
  if (!user) {
    // Don't reveal that email doesn't exist
    return {
      success: true,
      message: 'If the email exists, a password reset link will be sent',
    };
  }

  const resetToken = this.jwtService.sign(
    { sub: user.id, email: user.email, type: 'password_reset' },
    { expiresIn: '1h' },
  );

  const userName = user.firstName || user.username;
  await this.emailService.sendPasswordResetEmail(user.email, resetToken, userName);

  return {
    success: true,
    message: 'If the email exists, a password reset link will be sent',
  };
}
```

#### 4.2 Add Verification Endpoint

**File**: `backend/src/modules/auth/auth.controller.ts`

```typescript
@Post('verify-email')
async verifyEmail(@Body() dto: { token: string; email: string }) {
  return this.authService.verifyEmail(dto.token, dto.email);
}
```

**File**: `backend/src/modules/auth/auth.service.ts`

```typescript
async verifyEmail(token: string, email: string): Promise<{ success: boolean; message: string }> {
  try {
    const payload = this.jwtService.verify(token);
    
    if (payload.type !== 'email_verification') {
      throw new UnauthorizedException('Invalid token type');
    }
    
    if (payload.email !== email) {
      throw new UnauthorizedException('Email mismatch');
    }
    
    // Verify the user
    await this.usersService.verifyEmail(email);
    
    return { success: true, message: 'Email verified successfully' };
  } catch (error) {
    throw new UnauthorizedException('Invalid or expired verification token');
  }
}
```

#### 4.3 Add UsersService Method

**File**: `backend/src/modules/users/users.service.ts`

```typescript
async verifyEmail(email: string): Promise<void> {
  await this.userRepository.update(
    { email },
    { 
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
    }
  );
}

async updateVerificationSentAt(userId: number): Promise<void> {
  await this.userRepository.update(
    { id: userId },
    { registrationVerificationSentAt: new Date() }
  );
}
```

### Phase 5: Email Templates

#### 5.1 Base Layout Template

**File**: `backend/src/modules/email/providers/templates/base-layout.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #3f51b5; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .button { display: inline-block; background-color: #3f51b5; color: white; text-decoration: none; padding: 10px 20px; margin: 20px 0; border-radius: 4px; }
    .footer { text-align: center; font-size: 12px; color: #666; margin-top: 20px; }
    .token { background-color: #eee; padding: 10px; font-family: monospace; margin: 10px 0; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{title}}</h1>
    </div>
    <div class="content">
      {{{content}}}
    </div>
    <div class="footer">
      <p>This is an automated email. Please do not reply.</p>
    </div>
  </div>
</body>
</html>
```

#### 5.2 Verify Email Template

**File**: `backend/src/modules/email/providers/templates/verify-email.html`

```html
<p>Hi {{userName}},</p>
<p>Thank you for registering! Please verify your email address by clicking the button below:</p>
<div style="text-align: center;">
  <a class="button" href="{{verificationUrl}}">Verify Email Address</a>
</div>
<p>Or copy and paste this token on the verification page:</p>
<div class="token">{{token}}</div>
<p>This link will expire in {{expiresIn}}.</p>
<p>If you didn't create an account, you can safely ignore this email.</p>
```

#### 5.3 Password Reset Template

**File**: `backend/src/modules/email/providers/templates/password-reset.html`

```html
<p>Hi {{userName}},</p>
<p>We received a request to reset your password. Click the button below to create a new password:</p>
<div style="text-align: center;">
  <a class="button" href="{{resetUrl}}">Reset Password</a>
</div>
<p>Or copy and paste this token on the password reset page:</p>
<div class="token">{{token}}</div>
<p>This link will expire in {{expiresIn}}.</p>
<p>If you didn't request a password reset, you can safely ignore this email.</p>
```

#### 5.4 Welcome Email Template

**File**: `backend/src/modules/email/providers/templates/welcome-email.html`

```html
<p>Hi {{userName}},</p>
<p>Welcome to the application! Your account has been created successfully.</p>
<div style="text-align: center;">
  <a class="button" href="{{loginUrl}}">Log In</a>
</div>
<p>If you have any questions, please contact our support team.</p>
```

### Phase 6: Environment Variables

```bash
# Email Configuration
EMAIL_ENABLED=true
EMAIL_PROVIDER=nodemailer
FRONTEND_URL=http://localhost:4200

# Nodemailer (for development with MailDev)
EMAIL_HOST=127.0.0.1
EMAIL_PORT=1025
EMAIL_SECURE=false
EMAIL_USER=
EMAIL_PASSWORD=

# Production SMTP
# EMAIL_HOST=smtp.example.com
# EMAIL_PORT=587
# EMAIL_SECURE=false
# EMAIL_USER=noreply@example.com
# EMAIL_PASSWORD=secret
# EMAIL_FROM="App Name" <noreply@example.com>
```

### Phase 7: Testing

```typescript
describe('EmailService', () => {
  describe('sendVerificationEmail', () => {
    it('should send verification email with correct content');
    it('should return success on successful send');
    it('should return failure on send error');
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset email');
    it('should include reset token in email');
  });
});
```

---

## Estimated Effort

| Task | Days |
|------|------|
| Email module structure | 0.5 |
| Provider interface | 0.25 |
| Nodemailer provider | 0.5 |
| Email service | 0.5 |
| Configuration | 0.25 |
| Auth integration | 1.0 |
| Email templates (3) | 0.5 |
| Verification endpoint | 0.5 |
| Testing | 0.5 |
| **Total** | **4.5 days** |

---

## Future: Adding Other Providers

To add SendGrid, AWS SES, etc.:

1. Create new provider class implementing `EmailProvider` interface
2. Update `EmailModule` to use new provider:
   ```typescript
   {
     provide: EmailProvider,
     useClass: SendGridEmailProvider,  // Change here
   }
   ```
3. No changes needed to `EmailService` or `AuthService`

---

## Dependencies

- nodemailer package
- @nestjs/config (already used)
- fs module (built-in)
- JWT service (already used in auth)
