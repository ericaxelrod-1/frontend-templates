import { Injectable } from '@nestjs/common';
import { createCanvas } from 'canvas';
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
      captchaId,
      imageBase64,
      ...(includeTextInResponse && { text }),
    };
  }

  /**
   * Verify a CAPTCHA response
   */
  verifyCaptcha(captchaId: string, userInput: string): boolean {
    const captcha = this.captchas.get(captchaId);

    // Check if CAPTCHA exists and hasn't expired
    if (!captcha || captcha.expiresAt < new Date()) {
      return false;
    }

    // Case-insensitive comparison
    const isValid = captcha.text.toLowerCase() === userInput.toLowerCase();

    // Remove the CAPTCHA after validation attempt (one-time use)
    this.captchas.delete(captchaId);

    return isValid;
  }

  /**
   * Generate an SVG image with the CAPTCHA text
   */
  private generateCaptchaImage(text: string): string {
    // Create canvas
    const width = 200;
    const height = 70;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, width, height);

    // Add noise (random dots)
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255},0.5)`;
      ctx.beginPath();
      ctx.arc(
        Math.random() * width,
        Math.random() * height,
        Math.random() * 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Add lines for noise
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255},0.5)`;
      ctx.beginPath();
      ctx.moveTo(Math.random() * width, Math.random() * height);
      ctx.lineTo(Math.random() * width, Math.random() * height);
      ctx.stroke();
    }

    // Add text
    ctx.font = '40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Apply different colors, angles, and positions to each character
    for (let i = 0; i < text.length; i++) {
      // Random color
      ctx.fillStyle = `rgb(${Math.floor(Math.random() * 80)},${Math.floor(Math.random() * 80)},${Math.floor(Math.random() * 80)})`;

      // Random angle
      const angle = (Math.random() - 0.5) * 0.4;

      ctx.save();
      ctx.translate(30 + i * 25, height / 2);
      ctx.rotate(angle);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
    }

    // Return as base64 data URL
    return canvas.toDataURL('image/png');
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
