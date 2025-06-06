import { Injectable } from '@angular/core';

export interface PasswordStrengthResult {
  score: number; // 0-100
  message: string;
  isValid: boolean;
  details: {
    hasMinLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumbers: boolean;
    hasSpecialChars: boolean;
    noRepeatedChars: boolean;
    noCommonPatterns: boolean;
  };
}

@Injectable({
  providedIn: 'root'
})
export class PasswordGeneratorService {
  private readonly upperCaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  private readonly lowerCaseChars = 'abcdefghijklmnopqrstuvwxyz';
  private readonly numberChars = '0123456789';
  private readonly specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  private readonly commonPatterns = [
    '123456', 'password', 'qwerty', 'admin', '12345678', 
    'welcome', 'abcdef', 'abc123', 'letmein', 'monkey'
  ];

  /**
   * Generates a secure password
   * @param length Password length (default: 12)
   * @param options Generation options
   * @returns Generated password
   */
  generatePassword(length: number = 12, options?: {
    includeUppercase?: boolean;
    includeLowercase?: boolean;
    includeNumbers?: boolean;
    includeSpecialChars?: boolean;
    excludeSimilar?: boolean;
  }): string {
    const opts = {
      includeUppercase: true,
      includeLowercase: true,
      includeNumbers: true,
      includeSpecialChars: true,
      excludeSimilar: false,
      ...options
    };

    let charSet = '';
    let requiredChars = '';

    if (opts.includeUppercase) {
      const chars = opts.excludeSimilar ? this.upperCaseChars.replace(/[IO]/g, '') : this.upperCaseChars;
      charSet += chars;
      requiredChars += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    if (opts.includeLowercase) {
      const chars = opts.excludeSimilar ? this.lowerCaseChars.replace(/[ilo]/g, '') : this.lowerCaseChars;
      charSet += chars;
      requiredChars += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    if (opts.includeNumbers) {
      const chars = opts.excludeSimilar ? this.numberChars.replace(/[01]/g, '') : this.numberChars;
      charSet += chars;
      requiredChars += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    if (opts.includeSpecialChars) {
      charSet += this.specialChars;
      requiredChars += this.specialChars.charAt(Math.floor(Math.random() * this.specialChars.length));
    }

    if (!charSet) {
      throw new Error('At least one character type must be included');
    }

    // Generate remaining characters
    let password = requiredChars;
    for (let i = requiredChars.length; i < length; i++) {
      password += charSet.charAt(Math.floor(Math.random() * charSet.length));
    }

    // Shuffle the password to avoid predictable patterns
    return this.shuffleString(password);
  }

  /**
   * Validates password strength against security requirements
   * @param password Password to validate
   * @returns Password strength result
   */
  validatePassword(password: string): PasswordStrengthResult {
    const details = {
      hasMinLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumbers: /[0-9]/.test(password),
      hasSpecialChars: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
      noRepeatedChars: !/(.)\\1{2,}/.test(password),
      noCommonPatterns: !this.containsCommonPattern(password)
    };

    let score = 0;

    // Base score from length
    score += Math.min(password.length * 4, 40);

    // Character variety bonuses
    if (details.hasUppercase) score += 10;
    if (details.hasLowercase) score += 10;
    if (details.hasNumbers) score += 10;
    if (details.hasSpecialChars) score += 15;

    // Mixed character types bonus
    const charTypes = [
      details.hasUppercase,
      details.hasLowercase,
      details.hasNumbers,
      details.hasSpecialChars
    ].filter(Boolean).length;
    score += (charTypes - 1) * 5;

    // Penalties
    if (!details.noRepeatedChars) score -= 10;
    if (!details.noCommonPatterns) score -= 20;
    if (/^[A-Za-z]+$/.test(password)) score -= 10; // Letters only
    if (/^[0-9]+$/.test(password)) score -= 15; // Numbers only

    score = Math.max(0, Math.min(100, score));

    const isValid = Object.values(details).every(Boolean);
    
    let message: string;
    if (score >= 80) message = 'Very Strong';
    else if (score >= 60) message = 'Strong';
    else if (score >= 40) message = 'Moderate';
    else if (score >= 20) message = 'Weak';
    else message = 'Very Weak';

    return {
      score,
      message,
      isValid,
      details
    };
  }

  /**
   * Gets validation requirements for display
   * @returns Array of requirement descriptions
   */
  getPasswordRequirements(): string[] {
    return [
      'At least 8 characters long',
      'Contains uppercase letter (A-Z)',
      'Contains lowercase letter (a-z)',
      'Contains number (0-9)',
      'Contains special character (!@#$%^&*)',
      'No more than 2 repeated characters in a row',
      'Does not contain common patterns'
    ];
  }

  private shuffleString(str: string): string {
    const arr = str.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
  }

  private containsCommonPattern(password: string): boolean {
    const lowerPassword = password.toLowerCase();
    return this.commonPatterns.some(pattern => lowerPassword.includes(pattern));
  }
} 