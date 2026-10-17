import { Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard.js';
import { EraseResponseDto } from './dto/erase-response.dto.js';
import { ErasureService } from './erasure.service.js';

/**
 * The authenticated account erasure endpoint.
 *
 * ## The subject is the caller and there is no way to say otherwise
 *
 * `eraseSelf(user.sub)` is the whole surface. The id comes from the claim
 * `JwtAuthGuard` read out of the **verified** token (`jwt-auth.guard.ts:74`) and
 * from nowhere else: there is no request DTO, no path parameter and no query
 * parameter, so "erase user B" is not a request this route can express. It is
 * unrepresentable rather than merely checked.
 *
 * **An `EraseRequestDto` with an optional `subjectId` was here and was deleted.**
 * Its own documentation claimed the mismatch was refused downstream — *"If
 * `subjectId` does not match the authenticated caller's identity
 * (`authz.actor()`), PostgreSQL refuses with SQLSTATE 42501"*. Nothing refused
 * it. `ErasureService` runs its writes on a `pg` connection under
 * `SET LOCAL ROLE app_admin`, which carries no claims GUC, so `authz.actor()` is
 * NULL there and `users_update`'s only branch (`0008:421`,
 * `USING (current_user = 'app_admin')`) admits every row in the table. The claim
 * was checkable and it was false, which is the §2.1 shape: code that reads as a
 * finished cross-subject control and enforces nothing.
 *
 * The three ways a database could refuse it are each refused in their own right
 * — widening a read policy, setting `request.jwt.claims` from application code
 * (§B2 F1) and granting `app_member` a write verb on `users` — and the full
 * measurement is on `CLOSE_OPEN_REQUESTS_SQL` in `erasure.service.ts`. The
 * honest control is at this boundary, so the boundary carries no subject.
 *
 * Handler name `erase` on `PrivacyController` produces the dispatch token
 * `privacy.erase`, which is named in `KNOWN_DISPATCH_TOKENS` and checked by
 * `RouteCensus` at boot.
 *
 * ## Not on the identity seam — spec-identity.md
 *
 * This route does **not** carry the caller's verified bearer token through
 * `PostgrestClient`, so erasure still runs on a claimless `app_admin` session and
 * the database resolves `authz.actor()` to NULL. That is why the control above is
 * an application boundary and not a policy, and `test/rls/erasure-identity.spec.ts`
 * is the suite that says so out loud — including the two things the database
 * cannot currently enforce for this operation.
 */
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly erasureService: ErasureService) {}

  @Post('erase')
  @HttpCode(200)
  async erase(@Req() req: FastifyRequest & { user?: AccessTokenPayload }): Promise<EraseResponseDto> {
    const user = req.user;
    if (user === undefined || user.sub === undefined || user.sub === '') {
      throw new UnauthorizedException('Authentication required');
    }

    return this.erasureService.eraseSelf(user.sub);
  }
}
