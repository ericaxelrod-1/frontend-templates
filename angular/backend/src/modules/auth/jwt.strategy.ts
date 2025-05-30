import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'your-secret-key'),
    });
  }

  async validate(payload: any) {
    try {
      if (!payload || !payload.sub) {
        this.logger.warn('Invalid JWT payload structure');
        throw new UnauthorizedException('Invalid token structure');
      }

      // Successfully validated the token
      return {
        id: payload.sub,
        email: payload.email,
        permissions: payload.permissions || [],
      };
    } catch (error) {
      this.logger.error(`JWT validation error: ${error.message}`);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
