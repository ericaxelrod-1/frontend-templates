import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTH_EMAIL_VERIFICATION_CONFIRM,
  AUTH_EMAIL_VERIFICATION_REQUEST,
  AUTH_PASSWORD_RESET_CONFIRM,
  AUTH_PASSWORD_RESET_REQUEST,
  DISPATCH_TOKEN_PATTERN,
  KNOWN_DISPATCH_TOKENS,
  dispatchTokenForRoute,
} from '../../../src/breaker/dispatch-token.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * The four one-time-token dispatch tokens: that they exist, that they are
 * resolvable from the routes that mount, and — the part that can silently rot —
 * that nobody has added them to the protected list.
 *
 * ## The handler names here are snake_case, and that is forced
 *
 * `dispatchTokenForRoute` concatenates the handler's own name onto the
 * controller's, so `AuthController.password_reset_request` → `auth.password_reset_request`
 * and NOTHING else resolves. A lowerCamelCase handler yields
 * `auth.passwordResetRequest`, which no token names — and `route-census.ts` then
 * refuses to boot. `DISPATCH_TOKEN_PATTERN` is the reason: lowercase and
 * underscores only, no capitals.
 *
 * So the naming is load-bearing at boot, and asserting it here is what turns "a
 * renamed handler stops the process" from folklore into a red test that fires at the
 * rename rather than at the next deploy.
 *
 * ## Why "it is not protected" needs a test at all
 *
 * The omission is a decision recorded in `dispatch-token.ts`, and a decision in a
 * comment is exactly the kind of thing the next reader "fixes" while reading. The
 * failure is not a boot error: adding a token to `BREAKER_PROTECTED` boots
 * perfectly, and the four routes simply stop shedding under memory pressure. So
 * the way someone would break it is to type a token into a `.env` file, which is
 * why this reads the `.env*` files rather than comparing against a literal that
 * would change in the same edit.
 *
 * `test/unit/purge/purge-enqueuer-scheduling.spec.ts` does the same for
 * `purge.enqueuer`, and the reasoning is shared — one claim, one place it is
 * checked.
 */

const TOKEN_ROUTES: ReadonlyArray<{ readonly token: string; readonly handler: string }> = [
  { token: AUTH_PASSWORD_RESET_REQUEST, handler: 'password_reset_request' },
  { token: AUTH_PASSWORD_RESET_CONFIRM, handler: 'password_reset_confirm' },
  { token: AUTH_EMAIL_VERIFICATION_REQUEST, handler: 'email_verification_request' },
  { token: AUTH_EMAIL_VERIFICATION_CONFIRM, handler: 'email_verification_confirm' },
];

describe('the one-time-token routes are in the dispatch vocabulary', () => {
  it('every handler name on AuthController resolves to a token, which is what stops the boot', () => {
    for (const route of TOKEN_ROUTES) {
      // Asserted through the resolver the interceptor and the census both call,
      // rather than through `KNOWN_DISPATCH_TOKENS.includes(...)`. The membership
      // check would pass for a token the routes cannot reach, and the reachable
      // one is the one that matters: `dispatchTokenForRoute` returns `undefined`
      // for a near-miss such as `auth.passwordResetRequest`, which is what makes a
      // renamed handler a boot failure instead of a silent sheddable route.
      expect(dispatchTokenForRoute('AuthController', route.handler)).toBe(route.token);
      expect(DISPATCH_TOKEN_PATTERN.test(route.token)).toBe(true);
      expect(KNOWN_DISPATCH_TOKENS).toContain(route.token);
    }
  });

  it('a token is named by exactly one handler, because a shared token would make two routes one dispatch decision', () => {
    const names = TOKEN_ROUTES.map((route) => dispatchTokenForRoute('AuthController', route.handler));
    expect(new Set(names).size).toBe(TOKEN_ROUTES.length);
    // …and none of them collides with the four session routes already there.
    for (const token of names) {
      expect(KNOWN_DISPATCH_TOKENS.filter((candidate) => candidate === token)).toHaveLength(1);
    }
  });

  it('is NOT in BREAKER_PROTECTED in ANY mode, because shedding a retryable link request is correct', () => {
    const files = readdirSync(BACKEND_ROOT).filter((name) => name === '.env' || name.startsWith('.env.'));
    expect(files.length, 'no .env* files were found; this assertion would be vacuous').toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      const assigned = source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('BREAKER_PROTECTED='));
      expect(assigned, `${file} does not assign BREAKER_PROTECTED`).toHaveLength(1);
      for (const route of TOKEN_ROUTES) {
        expect(assigned[0], `${file} protects ${route.token}`).not.toContain(route.token);
      }
    }
  });
});