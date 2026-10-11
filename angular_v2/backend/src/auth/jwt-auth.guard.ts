import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import type { Environment } from '../config/environment.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export interface AccessTokenPayload {
  readonly sub: string;
  readonly role: string;
  readonly jti: string;
  readonly iat?: number;
  readonly exp: number;
}

/**
 * W11 slice 4 — the default-deny boundary of the thin app (§B5).
 *
 * Registered via APP_GUARD in AppModule, so every route is protected unless
 * it opts out with @Public(). Verifies the access token only — signature,
 * expiry, algorithm — with the same secret the issuer mints with. It never
 * reaches the database; permission and revocation checks belong to PostgREST
 * and db-pre-request, not to this guard (security.md).
 *
 * Every failure mode (missing header, malformed scheme, garbage token,
 * expired, tampered) is the same generic 401: the response never discloses
 * why, and no branch fails open.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly env: Environment;

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.env = config.getOrThrow<Environment>('environment');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AccessTokenPayload }>();
    const token = this.extractBearerToken(request);
    if (token === undefined) {
      throw new UnauthorizedException('unauthorized');
    }
    try {
      request.user = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.jwt.secret,
      });
    } catch {
      throw new UnauthorizedException('unauthorized');
    }
    return true;
  }

  private extractBearerToken(request: FastifyRequest): string | undefined {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || header.trim() === '') {
      return undefined;
    }
    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1] === undefined || parts[1].trim() === '') {
      return undefined;
    }
    return parts[1];
  }
}
