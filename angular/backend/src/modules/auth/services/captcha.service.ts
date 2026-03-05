import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Captcha } from '../entities/captcha.entity';
import * as crypto from 'crypto';
import * as canvas from 'canvas';

// Define captcha types
type CaptchaType = 'text' | 'image' | 'math' | 'puzzle';

@Injectable()
export class CaptchaService {
  constructor(
    @InjectRepository(Captcha)
    private readonly captchaRepository: Repository<Captcha>,
  ) { }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private generateTextChallenge(): { challenge: string; solution: string } {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
    const length = 6;
    const solution = Array.from(
      { length },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('');
    return { challenge: solution, solution };
  }

  private generateMathChallenge(): { challenge: string; solution: string } {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    const solution = (num1 + num2).toString();
    return { challenge: `${num1} + ${num2} = ?`, solution };
  }

  private async generateImageChallenge(): Promise<{
    challenge: string;
    solution: string;
  }> {
    const solution = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Create canvas
    const width = 200;
    const height = 80;
    const canvasInstance = canvas.createCanvas(width, height);
    const ctx = canvasInstance.getContext('2d');

    // Fill background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    // Add noise
    for (let i = 0; i < 50; i++) {
      ctx.strokeStyle = `rgba(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255},0.2)`;
      ctx.beginPath();
      ctx.moveTo(Math.random() * width, Math.random() * height);
      ctx.lineTo(Math.random() * width, Math.random() * height);
      ctx.stroke();
    }

    // Add text
    ctx.font = '40px Arial';
    ctx.fillStyle = 'black';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Add distortion to text
    for (let i = 0; i < solution.length; i++) {
      const x = (width / (solution.length + 1)) * (i + 1);
      const y = height / 2 + Math.random() * 10 - 5;
      const rotation = (Math.random() - 0.5) * 0.4;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.fillText(solution[i], 0, 0);
      ctx.restore();
    }

    return {
      challenge: canvasInstance.toDataURL(),
      solution,
    };
  }

  async create(
    type: CaptchaType = 'text',
    ipAddress?: string,
  ): Promise<Captcha> {
    let challenge: { challenge: string; solution: string };

    switch (type) {
      case 'math':
        challenge = this.generateMathChallenge();
        break;
      case 'text':
      default:
        challenge = this.generateTextChallenge();
        break;
    }

    const captcha = this.captchaRepository.create({
      type,
      token: this.generateToken(),
      challenge: challenge.challenge,
      solution: challenge.solution,
      ipAddress,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiration
    });

    return this.captchaRepository.save(captcha);
  }

  async validate(token: string, solution: string): Promise<boolean> {
    const captcha = await this.captchaRepository.findOne({
      where: { token },
    });

    if (!captcha || captcha.isUsed || captcha.expiresAt < new Date()) {
      return false;
    }

    const isValid = captcha.solution === solution;
    if (isValid) {
      captcha.isUsed = true;
      await this.captchaRepository.save(captcha);
    }

    return isValid;
  }

  async cleanupExpired(): Promise<void> {
    const now = new Date();
    await this.captchaRepository.delete({
      expiresAt: LessThan(now),
    });
  }
}
