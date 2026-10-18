import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard.js';
import { Public } from '../auth/public.decorator.js';
import { ChangePasswordDto } from './change-password.dto.js';
import { CreatedUserDto } from './created-user.dto.js';
import { CreateUserDto } from './create-user.dto.js';
import { EmailChangeAcceptedDto } from './email-change-accepted.dto.js';
import { EmailChangeConfirmDto } from './email-change-confirm.dto.js';
import { EmailChangeConfirmedDto } from './email-change-confirmed.dto.js';
import { EmailChangeRequestDto } from './email-change-request.dto.js';
import { LoginAttemptDto } from './login-attempt.dto.js';
import { UpdateProfileDto } from './update-profile.dto.js';
import { UserProfileDto } from './user-profile.dto.js';
import { UsersService } from './users.service.js';

/**
 * The member's own profile, and the administrator's user creation.
 *
 * ## EVERY HANDLER IS SNAKE_CASE, AND THAT IS NOT A STYLE CHOICE
 *
 * `dispatchTokenForRoute()` builds a route's dispatch token by **concatenating the
 * handler's own name** onto the controller's, and `DISPATCH_TOKEN_PATTERN` is
 * `/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/` — lowercase, underscores, no capitals. So
 * `me`, `update_me`, `request_email_change`, `confirm_email_change`,
 * `change_password`, `login_attempts` and `create` resolve to
 * `users.me`, `users.update_me`, … and a camelCase handler name would resolve to a token
 * nothing names, which `RouteCensus` answers by refusing to boot. `AuthController`
 * documents the same thing for its four routes; these are the other seven copies of
 * that decision, and **renaming one without the token stops the boot rather than
 * degrading quietly.**
 *
 * ## ONE ROUTE IS `@Public()` AND IT IS THE ONE THAT HAS TO BE
 *
 * `confirm_email_change` — `POST /users/me/email/confirm`. The link in an
 * address-change mail is opened by the person who received it, which is frequently
 * somebody who cannot sign in: they are locked out, or reading mail on another device.
 * The token IS the authentication for this route, exactly as it is for
 * `POST /auth/password-reset/confirm` and `POST /auth/email-verification/confirm`, and
 * requiring a session as well would demand a second proof of something the first proof
 * already establishes — in the one case the feature exists for.
 *
 * The other six are protected by the global `JwtAuthGuard` (`APP_GUARD`, default deny,
 * §B5) **by the absence of a decorator**, which is the direction that fails safely: a
 * handler that forgets `@Public()` is unreachable, never public.
 *
 * ## THE SUBJECT IS THE VERIFIED TOKEN'S `sub`, AND THERE IS NO WAY TO SAY OTHERWISE
 *
 * Six of these seven routes take no id. It comes from `req.user.sub`, which
 * `JwtAuthGuard` read out of a token it verified, and from nowhere else: no path
 * parameter, no body field, no query parameter. "Read or change user B" is not a request
 * this controller can express — it is unrepresentable rather than merely checked, which is
 * the property `PrivacyController.erase` argues for at length.
 *
 * **The single exception is `confirm_email_change`, and it is still not a caller-supplied
 * id.** Its subject comes from the redeemed token's `user_id`, which
 * `TokenService.mintEmailChange` bound to the `sub` of the request that asked for the
 * change. The chain terminates at the verified token.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * `GET /api/users/me` → `200`.
   *
   * The response is the twelve columns of `app_member`'s column grant, read with the
   * caller's OWN privileges through `PostgrestClient` — so the read is bounded by the
   * grant and by `users_read_scope`, and nothing the caller supplies can widen it. The
   * bearer token is forwarded because that is what makes the read the caller's: PostgREST
   * verifies it, sets `request.jwt.claims`, and PostgreSQL resolves `authz.actor()`.
   *
   * `200` and not `204`, because the body IS the answer: this is the member's own row and
   * a page that has to ask twice to learn what it came for is a worse page.
   */
  @Get('me')
  me(@Req() req: FastifyRequest & { user?: AccessTokenPayload; token?: string }): Promise<UserProfileDto> {
    const caller = requireUser(req);
    return this.usersService.me(caller.sub, req.token);
  }

  /**
   * `PATCH /api/users/me` → `200` with the refreshed row.
   *
   * **`200` and not `204`**, and the body is the reason: the response is what the
   * DATABASE stored, including its refusals of a blank name and its own timestamp
   * format, rather than an echo of what the client submitted. The frontend's
   * `profile-api.service.ts` documents that it relies on exactly this.
   */
  @Patch('me')
  @HttpCode(200)
  update_me(
    @Body() dto: UpdateProfileDto,
    @Req() req: FastifyRequest & { user?: AccessTokenPayload },
  ): Promise<UserProfileDto> {
    return this.usersService.updateMe(requireUser(req).sub, dto);
  }

  /**
   * `POST /api/users/me/email` → `202 { accepted: true }`.
   *
   * **`202`, and `accepted` is the whole body.** Neither half says the address changed:
   * the request was received, a link is on its way to the NEW address, and `users.email`
   * still holds the old one. Writing it here instead — and mailing the new address — is
   * the account takeover this route is two-phased to prevent; the argument is in
   * `UsersService.requestEmailChange` and it is worth reading before changing anything
   * about this handler.
   */
  @Post('me/email')
  @HttpCode(202)
  request_email_change(
    @Body() dto: EmailChangeRequestDto,
    @Req() req: FastifyRequest & { user?: AccessTokenPayload },
  ): Promise<EmailChangeAcceptedDto> {
    return this.usersService.requestEmailChange(requireUser(req).sub, dto);
  }

  /**
   * `POST /api/users/me/email/confirm` → `200 { status: 'email_changed' }`.
   *
   * The only `@Public()` route on this controller, and the reason is above: the token is
   * the authentication.
   *
   * **A failed redemption is a `422`, not a `400`** — and that is a deliberate difference
   * from the two existing confirm routes, which answer `400`. Those two are anonymous,
   * and their `400` body is a uniform "that link is not valid" for four different
   * failures; this one is equally uniform (same message, same `UNUSABLE_TOKEN_MESSAGE`)
   * and equally indistinguishable, so it could have been `400` too. It is `422` because
   * this is the one confirm route whose caller is a MEMBER — the frontend's
   * `describeProfileFailure` renders a `422` body with the server's reason on the profile
   * page, and renders a `400` as `HTTP 400`. A member who followed a link out of their
   * new mailbox and got nothing back is better served by a sentence than by a status.
   */
  @Public()
  @Post('me/email/confirm')
  @HttpCode(200)
  confirm_email_change(@Body() dto: EmailChangeConfirmDto): Promise<EmailChangeConfirmedDto> {
    return this.usersService.confirmEmailChange(dto);
  }

  /**
   * `POST /api/users/me/password` → `204`, no body.
   *
   * **A wrong `current_password` is a `422` and MUST NOT become a `401`.** `401` on this
   * application means the bearer token was refused, and the frontend's `authInterceptor`
   * treats exactly that as the end of the session: it clears the tokens and navigates to
   * `/access-denied`. A `401` here would sign the member out for mistyping their own
   * password and would make "your current password is wrong" and "your session has ended"
   * the same screen. See `UsersService.changePassword` for the full argument.
   *
   * `204` and no body because there is nothing to report: the row is hashed, the sessions
   * are revoked, and the number revoked is in the log rather than in the response.
   */
  @Post('me/password')
  @HttpCode(204)
  change_password(
    @Body() dto: ChangePasswordDto,
    @Req() req: FastifyRequest & { user?: AccessTokenPayload },
  ): Promise<void> {
    return this.usersService.changePassword(requireUser(req).sub, dto);
  }

  /**
   * `GET /api/users/me/login-attempts` → `200` with an array, most recent first.
   *
   * A bare array and not an envelope, because §B3 reserves `{ items, total, page }` for
   * the shared pagination helper and forbids hand-rolling one. `UsersService.loginAttempts`
   * explains why this is read elevated rather than through PostgREST — a member holds no
   * grant on `login_attempts` on purpose, and the read is bounded to the caller's own
   * username.
   *
   * **No `page` or `limit` is accepted.** The route takes no parameters at all, so
   * "give me somebody else's rows" is not a request it can express.
   */
  @Get('me/login-attempts')
  login_attempts(
    @Req() req: FastifyRequest & { user?: AccessTokenPayload },
  ): Promise<LoginAttemptDto[]> {
    return this.usersService.loginAttempts(requireUser(req).sub);
  }

  /**
   * `POST /api/users` → `201`.
   *
   * Nest's default for `POST` is `201`, and it is left unstated here for the same reason
   * `AuthController` states its codes: an implicit default is a number nobody chose.
   *
   * **Administrator-only, and the database is what enforces it** — `users_insert` is
   * `WITH CHECK (current_user = 'app_admin')` (`0008:420`) with `GRANT INSERT ON users`
   * naming only `app_admin` (`0023:602`). `UsersService.createUser` refuses first, with
   * a message a human can act on; that refusal is a fast answer, not a second mechanism
   * pretending to be the boundary.
   *
   * **The created account has no role and no group**, which violates §B2's invariant and
   * is logged at `warn` rather than papered over. `UsersService.createUser` explains the
   * choice and what it costs.
   */
  @Post()
  create(
    @Body() dto: CreateUserDto,
    @Req() req: FastifyRequest & { user?: AccessTokenPayload },
  ): Promise<CreatedUserDto> {
    return this.usersService.createUser(requireUser(req), dto);
  }
}

/**
 * The caller, or a `401`.
 *
 * **Unreachable for a route this controller mounts**, and that is the point of writing
 * it as a helper rather than `req.user!`. The global `JwtAuthGuard` answers `401` before
 * a handler runs for any route without `@Public()`, so by the time these bodies execute
 * `req.user` is set; §2.6 bans the `!` non-null assertion that is the usual way to say
 * so, and a cast would say it while being wrong. So the claim is CHECKED, and the
 * failure mode is the same generic `401` the guard uses — it names nothing.
 *
 * `AuthController.me` writes the same four lines for the same reason; §2.4 makes two
 * copies of an authorization decision a defect, but a three-line null check that is not
 * an authorization decision is not a mechanism worth extracting into a shared module.
 */
function requireUser(req: FastifyRequest & { user?: AccessTokenPayload }): AccessTokenPayload {
  const user = req.user;
  if (user === undefined || user.sub === undefined || user.sub === '') {
    throw new UnauthorizedException('unauthorized');
  }
  return user;
}
