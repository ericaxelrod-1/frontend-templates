import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Captcha } from '../entities/captcha.entity';
import * as crypto from 'crypto';

// Define captcha types
type CaptchaType = 'text' | 'image' | 'math' | 'puzzle';

@Injectable()
export class CaptchaService {
  constructor(
    @InjectRepository(Captcha)
    private readonly captchaRepository: Repository<Captcha>,
  ) {}

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

  // Generate SVG CAPTCHA image (pure JavaScript, no canvas)
  private generateSvgChallenge(): { challenge: string; solution: string } {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const length = 6;
    const solution = Array.from(
      { length },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('');
    
    const width = 200;
    const height = 70;
    const textChars = solution.split('');
    let charactersSvg = '';
    
    for (let i = 0; i < textChars.length; i++) {
      const x = 20 + i * 28;
      const y = 45 + (Math.random() - 0.5) * 10;
      const rotation = (Math.random() - 0.5) * 0.3;
      const fontSize = 32 + Math.floor(Math.random() * 8);
      const fill = `rgb(${Math.floor(30 + Math.random() * 40)},${Math.floor(30 + Math.random() * 40)},${Math.floor(30 + Math.random() * 40)})`;
      charactersSvg += `<text x="${x}" y="${y}" transform="rotate(${rotation}, ${x}, ${y})" fill="${fill}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${textChars[i]}</text>`;
    }
    
    let noiseSvg = '';
    for (let i = 0; i < 8; i++) {
      const x1 = Math.random() * width;
      const y1 = Math.random() * height;
      const x2 = Math.random() * width;
      const y2 = Math.random() * height;
      const stroke = `rgba(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},0.2)`;
      noiseSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1"/>`;
    }
    
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
    
    const challenge = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    
    return { challenge, solution };
  }

  async create(
    type: CaptchaType = 'image',
    ipAddress?: string,
  ): Promise<Captcha> {
    // Use SVG image CAPTCHA (pure JavaScript, no canvas)
    let challengeData: { challenge: string; solution: string };

    if (type === 'math') {
      challengeData = this.generateMathChallenge();
    } else if (type === 'image') {
      challengeData = this.generateSvgChallenge();
    } else {
      challengeData = this.generateTextChallenge();
    }

    const captcha = this.captchaRepository.create({
      type,
      token: this.generateToken(),
      challenge: challengeData.challenge,
      solution: challengeData.solution,
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

    const isValid = captcha.solution.toLowerCase() === solution.toLowerCase();
    if (isValid) {
      captcha.isUsed = true;
      await this.captchaRepository.save(captcha);
    }

    return isValid;
  }

  async validateToken(token: string): Promise<boolean> {
    const captcha = await this.captchaRepository.findOne({
      where: { token },
    });

    if (!captcha || captcha.isUsed || captcha.expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  async cleanupExpired(): Promise<void> {
    const now = new Date();
    await this.captchaRepository.delete({
      expiresAt: LessThan(now),
    });
  }
}
