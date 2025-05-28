import { Injectable, BadRequestException } from '@nestjs/common';

interface PasswordValidationOptions {
  minLength?: number;
  requireUppercase?: boolean;
  requireLowercase?: boolean;
  requireNumbers?: boolean;
  requireSpecialChars?: boolean;
  maxRepeatedChars?: number;
}

@Injectable()
export class PasswordValidationService {
  private defaultOptions: PasswordValidationOptions = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxRepeatedChars: 3,
  };

  /**
   * Validates a password against security requirements
   * @param password The password to validate
   * @param options Optional configuration to override default validation rules
   * @returns True if the password is valid
   * @throws BadRequestException if the password fails validation
   */
  validate(password: string, options: PasswordValidationOptions = {}): boolean {
    const config = { ...this.defaultOptions, ...options };
    const errors: string[] = [];

    if (password.length < config.minLength) {
      errors.push(
        `Password must be at least ${config.minLength} characters long`,
      );
    }

    if (config.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (config.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (config.requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (
      config.requireSpecialChars &&
      !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    ) {
      errors.push('Password must contain at least one special character');
    }

    if (config.maxRepeatedChars > 0) {
      // Check for repeated characters (e.g., 'aaa', '111')
      const repeatedCharsRegex = new RegExp(
        `(.)\\1{${config.maxRepeatedChars - 1},}`,
      );
      if (repeatedCharsRegex.test(password)) {
        errors.push(
          `Password cannot contain ${config.maxRepeatedChars} or more repeated characters in a row`,
        );
      }
    }

    // Common password patterns to check against
    const commonPatterns = [
      '123456',
      'password',
      'qwerty',
      'admin',
      '12345678',
      'welcome',
      'abcdef',
      'abc123',
    ];

    for (const pattern of commonPatterns) {
      if (password.toLowerCase().includes(pattern)) {
        errors.push(`Password contains a common pattern (${pattern})`);
        break;
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Password validation failed',
        details: errors,
      });
    }

    return true;
  }

  /**
   * Generates a password strength score (0-100)
   * @param password Password to evaluate
   * @returns A score from 0-100 indicating password strength
   */
  calculateStrength(password: string): number {
    if (!password) return 0;

    let score = 0;

    // Base score from length
    score += Math.min(password.length * 4, 40);

    // Bonus for character variety
    if (/[A-Z]/.test(password)) score += 10;
    if (/[a-z]/.test(password)) score += 10;
    if (/[0-9]/.test(password)) score += 10;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 15;

    // Bonus for mixed character types
    const charTypes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(
      (regex) => regex.test(password),
    ).length;
    score += (charTypes - 1) * 5;

    // Penalties
    if (/(.)\1{2,}/.test(password)) score -= 10; // Repeated characters
    if (/^[A-Za-z]+$/.test(password)) score -= 10; // Letters only
    if (/^[0-9]+$/.test(password)) score -= 15; // Numbers only

    // Common patterns/words penalty
    const commonPatterns = [
      '123456',
      'password',
      'qwerty',
      'admin',
      '12345678',
      'welcome',
      'abcdef',
      'abc123',
    ];
    for (const pattern of commonPatterns) {
      if (password.toLowerCase().includes(pattern)) {
        score -= 20;
        break;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Returns a textual description of password strength
   * @param score The password strength score (0-100)
   * @returns A string describing the password strength
   */
  getStrengthDescription(score: number): string {
    if (score >= 80) return 'very strong';
    if (score >= 60) return 'strong';
    if (score >= 40) return 'moderate';
    if (score >= 20) return 'weak';
    return 'very weak';
  }
}
