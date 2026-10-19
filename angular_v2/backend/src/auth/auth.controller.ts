import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { THROTTLE_POLICIES, ThrottleSkip } from '../common/throttle.js';
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

  /**
   * `POST /auth/login` — §B6's `login`, the route this repository's credential
   * attack starts at.
   *
   * **The tightened limit is the OUTER layer, and the per-account gate behind
   * it is the one that stops the attack.** The number here
   * (`THROTTLE_CREDENTIAL_LIMIT`) is generous on purpose: it sheds the volume
   * of a script — a hundred wrong passwords a minute from one address — and
   * it must not become the thing that locks a person out of their own account
   * on a shared address. The control that actually refuses a credential attack
   * against ONE account is `AuthService.gate()`: five failures against the
   * account, then a progressive delay and a block, counted in the database.
   *
   * **The two layers do not compound, and that is a property of the pipeline
   * rather than of the arithmetic.** This limiter is a guard, so it runs
   * BEFORE the handler, and the `login_attempts` row is written inside the
   * handler. A request this limiter refuses therefore never reaches the
   * account's budget at all: a caller who trips the address limit does not
   * also spend five of the account's failures. `test/unit/throttle/throttler.spec.ts`
   * proves it against the real application.
   */
  @Public()
  @Throttle({ default: THROTTLE_POLICIES.credential })
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

  /**
   * `POST /auth/password-reset/request` and
   * `POST /auth/email-verification/request` — §B6's `forgot-password`, the
   * route that sends a link.
   *
   * **The link policy (`THROTTLE_LINK_LIMIT`), and it is the tightest number
   * in the application because each of these costs an SMTP round trip** — the
   * most expensive thing this process does that is not a bcrypt hash — and
   * because a request for a link is an act against a MAILBOX. The per-address
   * budget in `login_attempts` (five requests per ten minutes, counted before
   * any account lookup) is what stops one inbox being bombed; this limit is
   * what stops the VOLUME from one address, which a per-address budget cannot
   * see because the addresses differ.
   *
   * **It is still a number a person never reaches.** Asking for a reset link
   * is something a person does once, not ten times a minute, and the number
   * has to stay above the seven requests one address can make in a burst
   * without becoming a denial of service on an office behind one NAT.
   */
  @Public()
  @Throttle({ default: THROTTLE_POLICIES.link })
  @Post('password-reset/request')
  @HttpCode(202)
  password_reset_request(
    @Body() dto: TokenRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<TokenRequestAcceptedDto> {
    return this.authService.requestToken(dto, 'password_reset', req.ip);
  }

  /**
   * `POST /auth/password-reset/confirm` — the route that MOVES a credential.
   *
   * **The credential policy, not the link policy, because this is the other
   * half of the reset**: it hashes a new password at cost 12 and kills every
   * live session, so it is the expensive end of the flow and the end where a
   * credential actually changes hands. The token is single-use and is consumed
   * by the first statement, so a caller cannot replay one — but the
   * address-keyed limit still sheds the volume of a script guessing tokens.
   */
  @Public()
  @Throttle({ default: THROTTLE_POLICIES.credential })
  @Post('password-reset/confirm')
  @HttpCode(200)
  password_reset_confirm(@Body() dto: PasswordResetConfirmDto): Promise<PasswordResetConfirmedDto> {
    return this.authService.confirmPasswordReset(dto);
  }

  /**
   * `POST /auth/email-verification/request` — the same shape as the reset
   * request and the same limit: one SMTP round trip, one mailbox, one link
   * policy.
   */
  @Public()
  @Throttle({ default: THROTTLE_POLICIES.link })
  @Post('email-verification/request')
  @HttpCode(202)
  email_verification_request(
    @Body() dto: TokenRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<TokenRequestAcceptedDto> {
    return this.authService.requestToken(dto, 'email_verification', req.ip);
  }

  /**
   * `POST /auth/email-verification/confirm` — the route that CONFIRMS a
   * credential, and the credential policy for the same reason the reset
   * confirmation has it: it consumes a single-use token and settles the
   * account's verified state, and a script that guesses tokens is exactly
   * what the address-keyed limit sheds.
   */
  @Public()
  @Throttle({ default: THROTTLE_POLICIES.credential })
  @Post('email-verification/confirm')
  @HttpCode(200)
  email_verification_confirm(@Body() dto: EmailVerificationConfirmDto): Promise<EmailVerificationConfirmedDto> {
    return this.authService.confirmEmailVerification(dto);
  }

  /**
   * `GET /auth/me` — the session-introspection read, and the ONE route in this
   * application that is exempt from the limiter.
   *
   * **Why it is exempt.** It is the only route here that does no work at all:
   * the guard has already verified the token, and the handler reads the
   * payload it verified and computes an expiry. No database, no SMTP, no
   * bcrypt — there is nothing to shed. What it IS is the question a client
   * asks to find out whether its session is still good, and a client may ask
   * it on every navigation, from every tab, on a timer. An address-keyed limit
   * on it converts one shared address — an office, a carrier NAT, a CI runner
   * — into a session-check outage for every client behind it, over a route
   * that costs nothing to serve.
   *
   * The application already says the same thing about this route in another
   * place: `auth.me` is one of the four tokens in `BREAKER_PROTECTED`, the
   * set the breaker refuses to shed under memory pressure. A route the
 * application will not shed when the host is out of memory is not a route to
   * refuse on a counter.
   *
   * **The exemption is explicit.** `@ThrottleSkip()` is the library's own
   * `SkipThrottle` under the name §B6 documents, not a hand-rolled metadata
   * key — a key nobody else reads is a key that stops exempting anything the
   * day the library changes its spelling.
   */
  @ThrottleSkip()
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