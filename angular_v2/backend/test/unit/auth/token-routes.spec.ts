import { RequestMethod } from '@nestjs/common';
// From `@nestjs/common/constants`, not the package root: the root entry does not
// re-export these three as values (they come back `undefined`), which is why
// `route-census.ts` imports them from the same place and reads method metadata off
// the HANDLER function rather than the prototype.
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { AuthController } from '../../../src/auth/auth.controller.js';
import { EmailVerificationConfirmDto } from '../../../src/auth/email-verification-confirm.dto.js';
import { EmailVerificationConfirmedDto } from '../../../src/auth/email-verification-confirmed.dto.js';
import { IS_PUBLIC_KEY } from '../../../src/auth/public.decorator.js';
import { PasswordResetConfirmDto } from '../../../src/auth/password-reset-confirm.dto.js';
import { PasswordResetConfirmedDto } from '../../../src/auth/password-reset-confirmed.dto.js';
import { TokenRequestAcceptedDto } from '../../../src/auth/token-request-accepted.dto.js';
import { TokenRequestDto } from '../../../src/auth/token-request.dto.js';
import type { TokenEnvironment } from '../../../src/token/token-environment.js';
import { TokenService } from '../../../src/token/token.service.js';
import type { EmailService } from '../../../src/email/email.service.js';

/**
 * The HTTP-boundary facts about the four one-time-token routes that need no
 * database, plus the one that needs the token primitive.
 *
 * These catch a defect **at boot** rather than in production. The other half of
 * this feature's evidence — that a reset really changes the password, that a second
 * use is refused, that rows are really written — is in
 * `test/e2e/password-reset.e2e-spec.ts` against a real Postgres, because §B8 says a
 * mock of the database hides exactly the schema and policy bugs worth catching.
 * Nothing here needs one, so nothing here pays for one.
 */

function metadata(key: string, target: object): unknown {
  return Reflect.getMetadata(key, target) as unknown;
}

/** The prototype method behind a controller handler name, or a thrown error naming the miss. */
function handlerOf(handlerName: string): object {
  const handler = (AuthController.prototype as unknown as Record<string, unknown>)[handlerName];
  if (typeof handler !== 'function') {
    throw new Error(`AuthController has no handler named ${handlerName}`);
  }
  return handler;
}

describe('every one-time-token route is public, because the caller has no credential by definition', () => {
  const ROUTES = [
    { handler: 'password_reset_request', path: 'password-reset/request', method: RequestMethod.POST, status: 202 },
    { handler: 'password_reset_confirm', path: 'password-reset/confirm', method: RequestMethod.POST, status: 200 },
    { handler: 'email_verification_request', path: 'email-verification/request', method: RequestMethod.POST, status: 202 },
    { handler: 'email_verification_confirm', path: 'email-verification/confirm', method: RequestMethod.POST, status: 200 },
  ] as const;

  it('carries @Public() on all four, because the omission is a 401 on the one route whose failure is "never locked out"', () => {
    // `JwtAuthGuard` is registered through `APP_GUARD` and this tree is default
    // deny (§B5). A handler without `@Public()` is unreachable, not merely
    // unprotected — so this is the assertion that a password reset is possible at
    // all for the person who cannot authenticate.
    for (const route of ROUTES) {
      expect(metadata(IS_PUBLIC_KEY, handlerOf(route.handler)), `${route.handler} is not @Public()`).toBe(true);
    }
  });

  it('is mounted where the reset and verification mails lead, on the method and status the body promises', () => {
    // `202 Accepted` on the two request routes is the only status that is literally
    // true for a request the application answers identically whether or not the
    // mailbox exists: `200 OK` claims the mail happened, and for an unregistered
    // address it did not. Changing either number changes what the response asserts.
    //
    // The paths are the backend half of a journey whose frontend half is fixed by
    // `PASSWORD_RESET_PATH` / `VERIFICATION_PATH` in `email.template-context.ts`;
    // a rename here with no matching frontend change is a 404 only a user following
    // a real link from a real mail would find.
    expect(metadata(PATH_METADATA, AuthController)).toBe('auth');
    for (const route of ROUTES) {
      const handler = handlerOf(route.handler);
      expect(metadata(PATH_METADATA, handler), route.handler).toBe(route.path);
      expect(metadata(METHOD_METADATA, handler), route.handler).toBe(route.method);
      expect(metadata(HTTP_CODE_METADATA, handler), route.handler).toBe(route.status);
    }
  });
});

describe('the accepted body carries nothing that could differ between a registered address and an empty one', () => {
  it('is a single field whose only value is the literal, so there is nothing for the two answers to differ in', () => {
    const accepted = new TokenRequestAcceptedDto();
    accepted.status = 'accepted';

    expect(Object.keys(accepted)).toEqual(['status']);
    expect(JSON.parse(JSON.stringify(accepted))).toEqual({ status: 'accepted' });

    // Named because this is the property the whole route rests on and one field
    // destroys it: a `tokenId`, an `expiresAt` or a `recipient` is a function of
    // whether the account exists, and adding one turns this DTO into the oracle the
    // service works to avoid.
    for (const forbidden of ['tokenId', 'token', 'expiresAt', 'recipient', 'email']) {
      expect(Object.keys(accepted), `the accepted body must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('reports a fact rather than a permission: neither confirm body claims a capability was granted', () => {
    // `login` gates on the password and on nothing else, so neither `password_reset`
    // nor `verified` may imply any route treats the account differently afterwards.
    const reset = new PasswordResetConfirmedDto();
    reset.status = 'password_reset';
    const verified = new EmailVerificationConfirmedDto();
    verified.status = 'verified';

    expect(Object.keys(reset)).toEqual(['status']);
    expect(Object.keys(verified)).toEqual(['status']);
  });
});

/**
 * A malformed address is a 400, and that is safe — because it is a statement about
 * the SHAPE of the input and carries nothing about whether the mailbox is
 * registered. Every registered address is a well-formed one, so the 400 and the
 * uniform `202` partition the input space by format and not by existence. If the
 * DTO ever started rejecting on anything an unregistered address could also fail,
 * this test would be asserting a different thing and the enumeration argument would
 * be gone; that is the reason it is written as a positive/negative pair rather than
 * left implicit in the DTO's comment.
 */
describe('the request DTO refuses garbage for a reason that has nothing to do with existence', () => {
  it('rejects a malformed address and accepts an unregistered but well-formed one', async () => {
    const rejected = ['not-an-address', 'a@b', '', 'two words@example.test', 'x@example.test\nBcc: victim@example.test'];
    for (const email of rejected) {
      const errors = await validate(plainToInstance(TokenRequestDto, { email }));
      expect(errors.some((error) => error.property === 'email'), `'${email}' was accepted`).toBe(true);
    }

    const accepted = ['nobody-here@example.test', 'a.b+tag@sub.example.test'];
    for (const email of accepted) {
      const errors = await validate(plainToInstance(TokenRequestDto, { email }));
      expect(errors, `'${email}' was rejected for a reason unrelated to existence`).toEqual([]);
    }
  });
});

const TOKEN_ENV: TokenEnvironment = {
  pepper: 'test-pepper-token-secret-must-be-32-chars-long',
  pepperKid: 'test-kid-v1',
};

/**
 * Whether `redeem` treated the input as ELIGIBLE FOR A LOOKUP.
 *
 * A window-eligible token produces a real `authz.redeem_auth_token` call; a token
 * outside the window never gets there — it returns after a constant-time dummy
 * comparison. The pool is the only place that difference is observable without a
 * database, so this is where the two windows are compared, by execution rather
 * than by reading two literals side by side.
 */
async function reachesRedemption(raw: string): Promise<boolean> {
  let reached = false;
  const pool = {
    connect: () =>
      Promise.resolve({
        query: (text: string) => {
          if (text.includes('authz.redeem_auth_token')) {
            reached = true;
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
        release: () => {},
      } as unknown as PoolClient),
  };
  await new TokenService(pool, TOKEN_ENV, {} as unknown as EmailService).redeem({
    rawToken: raw,
    expectedPurpose: 'password_reset',
  });
  return reached;
}

/** Whether the RESET confirm DTO accepts this token length (its other field is present). */
async function resetDtoAccepts(raw: string): Promise<boolean> {
  const errors = await validate(plainToInstance(PasswordResetConfirmDto, { token: raw, password: 'a-password' }));
  return errors.every((error) => error.property !== 'token');
}

/** Whether the VERIFICATION confirm DTO accepts this token length. */
async function verificationDtoAccepts(raw: string): Promise<boolean> {
  const errors = await validate(plainToInstance(EmailVerificationConfirmDto, { token: raw }));
  return errors.every((error) => error.property !== 'token');
}

/**
 * The confirm DTOs bound the token and the primitive bounds it, and the two windows
 * have to be the SAME window. A DTO narrower than the primitive 400s a token that
 * would have worked; one wider spends a round trip discovering the primitive was
 * going to refuse. Either way the uniform "that link is no good" answer becomes two
 * distinguishable outcomes, so all three sets are asserted equal rather than each
 * asserted "reasonable".
 */
describe('the confirm DTOs bound the token exactly as TokenService.redeem does', () => {
  it('accepts, and sends to the database, exactly the same lengths', async () => {
    for (const length of [0, 15, 16, 17, 256, 257]) {
      const raw = 'a'.repeat(length);
      const eligible = length >= 16 && length <= 256;

      expect(await resetDtoAccepts(raw), `length ${length}, reset DTO`).toBe(eligible);
      expect(await verificationDtoAccepts(raw), `length ${length}, verification DTO`).toBe(eligible);
      expect(await reachesRedemption(raw), `length ${length}, primitive`).toBe(eligible);
    }
  });

  it('refuses a token outside the window without reaching the database, which is the constant-cost path', async () => {
    // The short-circuit is preceded by `timingSafeEqual(DUMMY_HASH, DUMMY_HASH)`
    // inside `redeem`. What is observable here is that no lookup happened at all —
    // and that matters because a lookup which happened only for well-formed input
    // would be a shape oracle on the token itself.
    expect(await reachesRedemption('short')).toBe(false);
  });
});