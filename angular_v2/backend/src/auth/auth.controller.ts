import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { EmailVerificationConfirmDto } from './email-verification-confirm.dto.js';
import { EmailVerificationConfirmedDto } from './email-verification-confirmed.dto.js';
import { LoginRequestDto } from './login-request.dto.js';
import { LoginResponseDto } from './login-response.dto.js';
import { LogoutRequestDto } from './logout-request.dto.js';
import { MeResponseDto } from './me-response.dto.js';
import { PasswordResetConfirmDto } from './password-reset-confirm.dto.js';
import { PasswordResetConfirmedDto } from './password-reset-confirmed.dto.js';
import { Public } from './public.decorator.js';
import { RefreshRequestDto } from './refresh-request.dto.js';
import { RefreshResponseDto } from './refresh-response.dto.js';
import type { AccessTokenPayload } from './jwt-auth.guard.js';
import { TokenRequestAcceptedDto } from './token-request-accepted.dto.js';
import { TokenRequestDto } from './token-request.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body() dto: LoginRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<LoginResponseDto> {
    return this.authService.login(dto, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshRequestDto): Promise<RefreshResponseDto> {
    return this.authService.refresh(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: LogoutRequestDto): Promise<void> {
    return this.authService.logout(dto);
  }

  /**
   * Every route below is `@Public()`, and that is not a formality.
   *
   * The global `JwtAuthGuard` is registered through `APP_GUARD` and this tree is
   * **default deny** (§B5): a handler without `@Public()` is unreachable without a
   * bearer token. A password reset and an address verification are both requested
   * by someone who by definition cannot authenticate — the whole premise is that
   * they have lost or never had the credential. Forgetting the decorator here does
   * not produce a public route; it produces a `401` on the one route whose failure
   * mode is "the user can never get back in".
   *
   * ## The handler names are snake_case, and that is not a style choice
   *
   * `dispatchTokenForRoute()` builds its token by **concatenating the handler's own
   * name** onto the controller's (`AuthController` + `login` → `auth.login`), and
   * `DISPATCH_TOKEN_PATTERN` is `/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/` — lowercase,
   * underscores, no capitals. The four session routes above get away with
   * lowerCamelCase because each is a single word, where the two conventions are the
   * same string. A handler named `requestPasswordReset` therefore resolves to
   * `auth.requestPasswordReset`, which no token names, and `route-census.ts` throws
   * `RouteCensusError` and refuses to boot.
   *
   * So these four are named for their token segment, and **renaming one without
   * renaming the other breaks the boot rather than degrading quietly** — which is
   * the control working. If a future route wants camelCase, the fix belongs in
   * `dispatchTokenForRoute` and in a test that proves two distinct handlers cannot
   * normalise onto one token; it does not belong in a handler name here.
   *
   * `req.ip` is passed and not `req.hostname` or a header: the throttle keys on the
   * canonical address the transport saw, and `X-Forwarded-For` is not read because
   * no trusted proxy is configured to vouch for it.
   *
   * `202` rather than `200` on both request routes, and the DTO's own comment
   * explains why: `202 Accepted` is the only status that is literally true for a
   * request the application answers identically whether or not the mailbox exists.
   */

  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  password_reset_request(
    @Body() dto: TokenRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<TokenRequestAcceptedDto> {
    return this.authService.requestToken(dto, 'password_reset', req.ip);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  password_reset_confirm(@Body() dto: PasswordResetConfirmDto): Promise<PasswordResetConfirmedDto> {
    return this.authService.confirmPasswordReset(dto);
  }

  @Public()
  @Post('email-verification/request')
  @HttpCode(202)
  email_verification_request(
    @Body() dto: TokenRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<TokenRequestAcceptedDto> {
    return this.authService.requestToken(dto, 'email_verification', req.ip);
  }

  @Public()
  @Post('email-verification/confirm')
  @HttpCode(200)
  email_verification_confirm(@Body() dto: EmailVerificationConfirmDto): Promise<EmailVerificationConfirmedDto> {
    return this.authService.confirmEmailVerification(dto);
  }

  @Get('me')
  me(@Req() req: FastifyRequest & { user?: AccessTokenPayload }): MeResponseDto {
    const user = req.user;
    if (user === undefined) {
      throw new UnauthorizedException('unauthorized');
    }
    return {
      sub: user.sub,
      role: user.role,
      expiresIn: Math.max(0, user.exp - Math.floor(Date.now() / 1000)),
    };
  }
}