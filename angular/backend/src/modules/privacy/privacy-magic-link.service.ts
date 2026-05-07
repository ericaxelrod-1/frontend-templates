import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface MagicLinkPayload {
  ticketId: number;
  email: string;
  type: 'privacy_status';
}

@Injectable()
export class PrivacyMagicLinkService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  generateToken(ticketId: number, email: string, expiresIn?: string): string {
    const payload: MagicLinkPayload = { ticketId, email, type: 'privacy_status' };
    return this.jwtService.sign(payload, {
      expiresIn: expiresIn || '24h',
      secret: this.configService.get<string>('PRIVACY_MAGIC_LINK_SECRET', 'privacy-magic-secret'),
    });
  }

  verifyToken(token: string): MagicLinkPayload {
    try {
      const payload = this.jwtService.verify<MagicLinkPayload>(token, {
        secret: this.configService.get<string>('PRIVACY_MAGIC_LINK_SECRET', 'privacy-magic-secret'),
      });
      
      if (payload.type !== 'privacy_status') {
        throw new UnauthorizedException('Invalid token type');
      }
      
      return payload;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }
  }

  generateUrl(token: string): string {
    const baseUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    return `${baseUrl}/privacy/request/status?token=${token}`;
  }
}
