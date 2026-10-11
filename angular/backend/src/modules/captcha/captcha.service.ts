import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { CaptchaResult } from './captcha.models';

@Injectable()
export class CaptchaService {
  // Store generated CAPTCHAs with expiration (5 minutes)
  private captchas: Map<string, { text: string; expiresAt: Date }> = new Map();

  // Clean up expired CAPTCHAs periodically
  constructor() {
    setInterval(() => this.cleanupExpiredCaptchas(), 60000); // Every minute
  }

  /**
   * Generate a new CAPTCHA image with random text
   */
  generateCaptcha(includeTextInResponse: boolean = false): CaptchaResult {
    // Generate random text (alphanumeric, excluding confusing characters)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let text = '';
    for (let i = 0; i < 6; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Create a unique ID for this CAPTCHA
    const captchaId = crypto.randomUUID();

    // Store CAPTCHA text with expiration time (5 minutes)
    this.captchas.set(captchaId, {
      text,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // Generate image
    const imageBase64 = this.generateCaptchaImage(text);

    // Return result (optionally including text for debugging)
    return {
      token: captchaId,
      challenge: imageBase64,
      type: 'image',
      ...(includeTextInResponse && { text }),
    };
  }

  /**
   * Verify a CAPTCHA response
   */
  verifyCaptcha(captchaToken: string, captchaSolution: string): boolean {
    const captcha = this.captchas.get(captchaToken);

    // Check if CAPTCHA exists and hasn't expired
    if (!captcha || captcha.expiresAt < new Date()) {
      return false;
    }

    // Case-insensitive comparison
    const isValid = captcha.text.toLowerCase() === captchaSolution.toLowerCase();

    // Remove the CAPTCHA after validation attempt (one-time use)
    this.captchas.delete(captchaToken);

    return isValid;
  }

  /**
   * Generate an SVG image with the CAPTCHA text (no canvas dependency)
   */
  private generateCaptchaImage(text: string): string {
    const width = 200;
    const height = 70;
    
    // Split text into characters with individual transforms
    const chars = text.split('');
    let charactersSvg = '';
    
    for (let i = 0; i < chars.length; i++) {
      const x = 20 + i * 28;
      const y = 45 + (Math.random() - 0.5) * 10;
      const rotation = (Math.random() - 0.5) * 0.3;
      const fontSize = 32 + Math.floor(Math.random() * 8);
      const fill = `rgb(${Math.floor(30 + Math.random() * 40)},${Math.floor(30 + Math.random() * 40)},${Math.floor(30 + Math.random() * 40)})`;
      charactersSvg += `<text x="${x}" y="${y}" transform="rotate(${rotation}, ${x}, ${y})" fill="${fill}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${chars[i]}</text>`;
    }
    
    // Add noise lines
    let noiseSvg = '';
    for (let i = 0; i < 8; i++) {
      const x1 = Math.random() * width;
      const y1 = Math.random() * height;
      const x2 = Math.random() * width;
      const y2 = Math.random() * height;
      const stroke = `rgba(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},0.2)`;
      noiseSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1"/>`;
    }
    
    // Add noise circles
    for (let i = 0; i < 15; i++) {
      const cx = Math.random() * width;
      const cy = Math.random() * height;
      const r = 1 + Math.random() * 2;
      const fill = `rgba(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},0.15)`;
      noiseSvg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
    }
    
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#f8f8f8"/>
      ${noiseSvg}
      ${charactersSvg}
    </svg>`;
    
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  /**
   * Clean up expired CAPTCHAs
   */
  private cleanupExpiredCaptchas(): void {
    const now = new Date();
    for (const [id, captcha] of this.captchas.entries()) {
      if (captcha.expiresAt < now) {
        this.captchas.delete(id);
      }
    }
  }
}
