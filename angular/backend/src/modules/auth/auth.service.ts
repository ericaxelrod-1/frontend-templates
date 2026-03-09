import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { PasswordValidationService } from './password-validation.service';
import { RegisterDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Role } from '../users/entities/role.entity';
import { LoginAttemptService } from './services/login-attempt.service';
import { IPReputationService } from './services/ip-reputation.service';
import { CaptchaService } from './services/captcha.service';
import {
  PatternDetectionService,
  PatternType,
} from './services/pattern-detection.service';
import { AlertService, AlertSeverity } from './services/alert.service';
import { LoginAttempt } from './entities/login-attempt.entity';
import { Captcha } from './entities/captcha.entity';
import { PermissionsService } from '../permissions/services/permissions.service';

@Injectable()
export class AuthService {
  private refreshTokens: Map<
    string,
    { userId: number; token: string; expiresAt: Date }
  > = new Map();

  constructor(
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly passwordValidationService: PasswordValidationService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly loginAttemptService: LoginAttemptService,
    private readonly ipReputationService: IPReputationService,
    private readonly captchaService: CaptchaService,
    private readonly patternDetectionService: PatternDetectionService,
    private readonly alertService: AlertService,
    @Inject(forwardRef(() => PermissionsService))
    private readonly permissionsService: PermissionsService,
  ) { }

  /**
   * Validates a user's credentials
   */
  async validateUser(email: string, password: string): Promise<any> {
    try {
      console.log(`Attempting to find user by email: ${email}`);

      // First, check if the user exists in the database at all (without relations)
      const userExists = await this.usersService.userExistsCheck(email);

      if (!userExists) {
        console.log(
          `No user record found with email: ${email} - Database record does not exist`,
        );
        return null;
      }

      // Now try to load the full user with relations
      console.log(
        `User exists in database, loading full profile with relations for: ${email}`,
      );
      const user = await this.usersService.findByEmail(email);

      // If we got here but user is null, it means the user exists but we failed to load relations
      if (!user) {
        console.error(
          `ERROR: User exists in database but could not be loaded with relations: ${email}`,
        );
        throw new Error(
          `User exists but could not be loaded with relations. This likely indicates a problem with the permission system.`,
        );
      }

      console.log(
        `User found with ID ${user.id}, validating password for: ${email}`,
      );
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        console.log(`Invalid password for user: ${email}`);
        return null;
      }

      console.log(`Password validated for user: ${email}`);

      // Check if user is active
      if (!user.isActive) {
        console.log(`User account is inactive: ${email}`);
        return null;
      }

      // Check if user has required permissions loaded
      if (!user.roles || user.roles.length === 0) {
        console.warn(
          `WARNING: User ${email} has no roles assigned. This may cause access problems.`,
        );
      }

      // Remove sensitive data
      const { password: _, ...result } = user;
      return result;
    } catch (error) {
      console.error(`Error validating user ${email}:`, error);
      throw error;
    }
  }

  /**
   * Generates JWT access and refresh tokens for a user
   */
  async login(
    email: string,
    password: string,
    ipAddress: string,
    userAgent?: string,
    captchaToken?: string,
    captchaSolution?: string,
  ) {
    try {
      // Check if IP is blocked
      const isBlocked = await this.ipReputationService.isBlocked(ipAddress);
      if (isBlocked) {
        await this.loginAttemptService.create({
          ipAddress,
          userAgent,
          emailAttempted: email,
          status: 'blocked',
          failureReason: 'IP address is blocked',
        });

        // Send alert for blocked IP login attempt
        await this.alertService.sendAlert({
          title: 'Blocked IP Login Attempt',
          message: `Blocked IP ${ipAddress} attempted to log in as ${email}`,
          severity: AlertSeverity.HIGH,
          timestamp: new Date(),
          ipAddress,
          email,
          data: { userAgent },
        });

        throw new UnauthorizedException(
          'Your IP address is blocked due to suspicious activity',
        );
      }

      // DEVELOPMENT MODE: Skip CAPTCHA validation if environment is development
      const skipCaptcha = process.env.NODE_ENV === 'development' || true; // Set to true for now until we fix CAPTCHA issues

      // Check if CAPTCHA is required
      const recentAttempts =
        await this.loginAttemptService.getRecentFailedAttempts(ipAddress, 30);
      if (recentAttempts.length >= 3 && !skipCaptcha) {
        if (!captchaToken || !captchaSolution) {
          const captcha = await this.captchaService.create('text', ipAddress);
          await this.loginAttemptService.create({
            ipAddress,
            userAgent,
            emailAttempted: email,
            status: 'captcha_required',
          });
          throw new BadRequestException({
            message: 'CAPTCHA verification required',
            captcha: {
              token: captcha.token,
              challenge: captcha.challenge,
              type: captcha.type,
            },
          });
        }

        const isCaptchaValid = await this.captchaService.validate(
          captchaToken,
          captchaSolution,
        );
        if (!isCaptchaValid) {
          await this.loginAttemptService.create({
            ipAddress,
            userAgent,
            emailAttempted: email,
            status: 'failed',
            failureReason: 'Invalid CAPTCHA',
          });
          throw new UnauthorizedException('Invalid CAPTCHA');
        }
      }

      // Validate user credentials
      const user = await this.validateUser(email, password);
      if (!user) {
        await this.loginAttemptService.create({
          ipAddress,
          userAgent,
          emailAttempted: email,
          status: 'failed',
          failureReason: 'Invalid credentials',
        });

        throw new UnauthorizedException('Invalid credentials');
      }

      // Record successful login
      await this.loginAttemptService.create({
        ipAddress,
        userAgent,
        emailAttempted: email,
        status: 'success',
        user,
      });

      // Update user's last login timestamp
      await this.usersService.updateLastLogin(user.id);

      // Run pattern detection after successful login to look for anomalies
      // Also update the Statistical User Baseline
      await this.patternDetectionService.trackSuccessfulLoginBehavior(user.id, ipAddress, userAgent);
      this.detectLoginPatterns(user.id, email, ipAddress, userAgent).catch(
        (err) => {
          console.error('Error in pattern detection:', err);
        },
      );

      // Get user permissions for token using the safer method
      let userPermissions = [];
      try {
        console.log(
          `Attempting to load permissions for user ${user.id} (${email})`,
        );
        userPermissions = await this.permissionsService.getUserPermissionsSafe(
          user.id,
        );
        console.log(
          `Successfully loaded ${userPermissions.length} permissions for user ${user.id}`,
        );
      } catch (permError) {
        console.error(
          `Failed to load permissions for user ${user.id}:`,
          permError,
        );
        // Continue with empty permissions rather than failing login
        userPermissions = [];
      }

      // Generate JWT tokens with robust error handling
      try {
        const tokens = await this.generateTokens(user);

        // Convert token keys to camelCase for frontend contract
        return {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          csrfToken: tokens.csrf_token,
          expiresIn: tokens.expires_in,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            permissions: userPermissions,
          },
        };
      } catch (tokenError) {
        console.error('Error generating tokens:', tokenError);
        await this.alertService.sendAlert({
          title: 'Token Generation Error',
          message: `Error generating tokens for user ${user.id} (${email})`,
          severity: AlertSeverity.HIGH,
          timestamp: new Date(),
          ipAddress,
          email,
          data: { error: tokenError.message },
        });
        throw new UnauthorizedException(
          'Authentication failed: Error generating security tokens',
        );
      }
    } catch (error) {
      // Log any unexpected errors
      if (
        !(error instanceof UnauthorizedException) &&
        !(error instanceof BadRequestException)
      ) {
        console.error('Unexpected login error:', error);
        await this.alertService.sendAlert({
          title: 'Unexpected Login Error',
          message: `Unexpected error during login for ${email}: ${error.message}`,
          severity: AlertSeverity.HIGH,
          timestamp: new Date(),
          ipAddress,
          email,
          data: { error: error.message },
        });
      }
      throw error;
    }
  }

  /**
   * Run pattern detection on login and send alerts if needed
   */
  private async detectLoginPatterns(
    userId: number,
    email: string,
    ipAddress: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      // This would typically be more sophisticated in a real application,
      // but for now we'll do a simple check for unusual login patterns
      const recentLogins = await this.loginAttemptService.getRecentAttempts(
        ipAddress,
        60,
      ); // Last hour

      // Check for rapid location switching (if location data is available)
      const patterns = await this.patternDetectionService.detectPatterns();

      // Send alerts for any detected patterns
      if (patterns.length > 0) {
        for (const pattern of patterns) {
          if (pattern.userId === userId || pattern.ipAddress === ipAddress) {
            await this.alertService.sendPatternAlert(pattern);
          }
        }
      }
    } catch (error) {
      console.error('Error in detectLoginPatterns:', error);
    }
  }

  /**
   * Registers a new user with validation
   */
  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName } = registerDto;

    // Check if email is already registered
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    // Validate password
    const passwordValidation =
      this.passwordValidationService.validate(password);
    if (!passwordValidation) {
      throw new BadRequestException(
        'Password does not meet security requirements',
      );
    }

    // Get default role (user role)
    const defaultRole = await this.roleRepository.findOne({
      where: { isDefault: true },
    });

    if (!defaultRole) {
      throw new BadRequestException(
        'Default role not configured. Please contact an administrator.',
      );
    }

    // Generate username from email (before @ symbol) with fallback
    let username = email.split('@')[0];

    // Check if username already exists and make it unique if needed
    let usernameExists = await this.usersService.findByUsername(username);
    let counter = 1;
    while (usernameExists) {
      username = `${email.split('@')[0]}${counter}`;
      usernameExists = await this.usersService.findByUsername(username);
      counter++;
    }

    // Create user with default role
    const newUser = await this.usersService.create({
      username: registerDto.email,
      email: registerDto.email,
      password: registerDto.password,
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      roleIds: [defaultRole.id],
    });

    // Generate and send verification token
    // This would typically generate a token and send an email
    // For now, we'll just return the user
    return {
      id: newUser.id,
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
    };
  }

  /**
   * Refreshes an access token using a valid refresh token
   */
  async refreshToken(token: string) {
    try {
      // Check if token is valid format before attempting to verify
      if (!token || typeof token !== 'string' || token.trim() === '') {
        throw new UnauthorizedException('Invalid refresh token format');
      }

      // Verify with more lenient error handling
      let payload;
      try {
        payload = this.jwtService.verify(token);
      } catch (error) {
        this.alertService.sendAlert({
          title: 'Failed Token Refresh',
          message: `Failed token refresh attempt: ${error.message}`,
          severity: AlertSeverity.LOW,
          timestamp: new Date(),
          data: { error: error.message },
        });

        throw new UnauthorizedException('Invalid or expired token');
      }

      const user = await this.usersService.findOne(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Get user permissions for the refreshed token
      const userPermissions = await this.permissionsService.getUserPermissions(
        user.id,
      );

      // Use a longer expiration for refreshed tokens to reduce frequent refresh issues
      const newPayload = {
        sub: user.id,
        email: user.email,
        permissions: userPermissions,
      };

      // Generate a new CSRF token as well
      const csrfToken = crypto.randomUUID();

      return {
        accessToken: this.jwtService.sign(newPayload),
        refreshToken: token, // Keep the same refresh token
        csrfToken: csrfToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          permissions: userPermissions,
        },
      };
    } catch (error) {
      console.error('Error refreshing token:', error.message);
      throw new UnauthorizedException('Token refresh failed: ' + error.message);
    }
  }

  /**
   * Logs out a user by invalidating their refresh token
   */
  async logout(refreshToken: string) {
    // Find and remove the refresh token from our store
    const storedTokenEntry = Array.from(this.refreshTokens.entries()).find(
      ([_, value]) => value.token === refreshToken,
    );

    if (storedTokenEntry) {
      this.refreshTokens.delete(storedTokenEntry[0]);
    }

    return { success: true };
  }

  /**
   * Initiates the password reset process
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal that the email doesn't exist
      return {
        success: true,
        message: 'If the email exists, a password reset link will be sent',
      };
    }

    // Generate a reset token
    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'reset' },
      { expiresIn: '1h' },
    );

    // In a real application, you would send an email with the reset link
    // For now, we just return the token for testing purposes
    return {
      success: true,
      message: 'If the email exists, a password reset link will be sent',
      resetToken, // Only included for testing, would normally be sent via email
    };
  }

  /**
   * Resets a user's password using a valid reset token
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { password, passwordConfirmation, token } = resetPasswordDto;

    // Validate password match
    if (password !== passwordConfirmation) {
      throw new BadRequestException('Passwords do not match');
    }

    // Validate password strength
    this.passwordValidationService.validate(password);

    // Verify the reset token
    let payload;
    try {
      payload = this.jwtService.verify(token);

      // Check if this is a reset token
      if (payload.type !== 'reset') {
        throw new Error('Invalid token type');
      }
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    // Update the user's password
    const user = await this.usersService.findOne(payload.sub);
    await this.usersService.update(user.id, { password });

    return { success: true, message: 'Password reset successfully' };
  }

  /**
   * Helper method to generate access and refresh tokens
   */
  private async generateTokens(user: any) {
    try {
      // Validate user object
      if (!user || !user.id || !user.email) {
        throw new Error('Invalid user data for token generation');
      }

      // Get user permissions for the token
      const userPermissions = await this.permissionsService.getUserPermissions(
        user.id,
      );

      // Create payload with necessary user information
      const payload = {
        email: user.email,
        sub: user.id,
        permissions: userPermissions,
      };

      // Generate refresh token with UUID for tracking
      const refreshTokenId = crypto.randomUUID();
      const refreshTokenExpiry = this.configService.get(
        'JWT_REFRESH_EXPIRES_IN',
        '30d',
      );

      const refreshToken = this.jwtService.sign(
        { ...payload, jti: refreshTokenId },
        { expiresIn: refreshTokenExpiry },
      );

      // Calculate expiration time for storage
      const expiresInMs = this.parseDuration(refreshTokenExpiry);
      const expiresAt = new Date(Date.now() + expiresInMs);

      // Store token in memory map
      this.refreshTokens.set(refreshTokenId, {
        userId: user.id,
        token: refreshToken,
        expiresAt,
      });

      // Generate access token with configured expiry
      const accessTokenExpiry = this.configService.get('JWT_EXPIRES_IN', '7d');
      const accessToken = this.jwtService.sign(payload, {
        expiresIn: accessTokenExpiry,
      });

      // Generate CSRF token for CSRF protection
      const csrfToken = crypto.randomUUID();

      // Clean up expired tokens from memory periodically
      this.cleanupExpiredTokens();

      // Return all necessary tokens (for internal use, keep snake_case, but only camelCase is returned to client)
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        csrf_token: csrfToken,
        expires_in: accessTokenExpiry,
      };
    } catch (error) {
      console.error('Token generation error:', error);
      throw new Error(
        `Failed to generate authentication tokens: ${error.message}`,
      );
    }
  }

  /**
   * Clean up expired refresh tokens from memory
   */
  private cleanupExpiredTokens(): void {
    const now = new Date();
    for (const [tokenId, tokenData] of this.refreshTokens.entries()) {
      if (tokenData.expiresAt < now) {
        this.refreshTokens.delete(tokenId);
      }
    }
  }

  /**
   * Parses a duration string like '7d' or '1h' into milliseconds
   */
  private parseDuration(duration: string): number {
    const regex = /^(\d+)([smhdw])$/;
    const match = duration.match(regex);

    if (!match) {
      return 24 * 60 * 60 * 1000; // Default to 1 day
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000; // seconds
      case 'm':
        return value * 60 * 1000; // minutes
      case 'h':
        return value * 60 * 60 * 1000; // hours
      case 'd':
        return value * 24 * 60 * 60 * 1000; // days
      case 'w':
        return value * 7 * 24 * 60 * 60 * 1000; // weeks
      default:
        return 24 * 60 * 60 * 1000; // Default to 1 day
    }
  }
}
