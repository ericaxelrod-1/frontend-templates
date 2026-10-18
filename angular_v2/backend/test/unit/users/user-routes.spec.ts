import { RequestMethod } from '@nestjs/common';
// From `@nestjs/common/constants`, not the package root: the root entry does not
// re-export these three as values, which is why `route-census.ts` imports them from
// the same place and reads method metadata off the HANDLER function rather than the
// prototype.
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'node:fs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from '../../../src/auth/public.decorator.js';
import { PasswordResetConfirmDto } from '../../../src/auth/password-reset-confirm.dto.js';
import { dispatchTokenForRoute, KNOWN_DISPATCH_TOKENS } from '../../../src/breaker/dispatch-token.js';
import { ChangePasswordDto } from '../../../src/users/change-password.dto.js';
import { CreateUserDto } from '../../../src/users/create-user.dto.js';
import { EmailChangeConfirmDto } from '../../../src/users/email-change-confirm.dto.js';
import { EmailChangeRequestDto } from '../../../src/users/email-change-request.dto.js';
import { UpdateProfileDto } from '../../../src/users/update-profile.dto.js';
import { UserProfileDto } from '../../../src/users/user-profile.dto.js';
import { UsersController } from '../../../src/users/users.controller.js';
import {
  COMPOSITE_TOKEN_PREFIXES,
  EMAIL_CHANGE_TOKEN_MAX_LENGTH,
  EMAIL_CHANGE_TOKEN_MIN_LENGTH,
  EMAIL_CHANGE_TOKEN_PREFIX,
  emailChangeSubject,
  MAX_PENDING_EMAIL_LENGTH,
  normalizePendingEmail,
  readEmailChangeToken,
} from '../../../src/token/email-change-token.js';

/**
 * The facts about the seven `/users` routes that need no database, plus the wire
 * contract each DTO pins.
 *
 * ## WHY THE ROUTE TABLE IS ASSERTED FROM THE DECORATORS
 *
 * Restating it here would make this file a second copy that can pass while the
 * controller says something else — which is exactly the §2.1 shape. So every case below
 * reads `PATH_METADATA` / `METHOD_METADATA` / `HTTP_CODE_METADATA` off the handler, the
 * same way the router explorer mounts them and the same way
 * `test/unit/auth/token-routes.spec.ts` asserts `AuthController`.
 *
 * The dispatch-token assertion is the one that earns its keep: `RouteCensus` refuses to
 * boot a graph with a mounted route no token names, and `dispatchTokenForRoute`
 * concatenates the CONTROLLER name with the HANDLER name, so a camelCase handler here is
 * a boot failure rather than a style difference. Asserted through the resolver rather than
 * through `KNOWN_DISPATCH_TOKENS.includes(...)`, because the membership check passes for
 * a token no route can reach.
 */

/** The controller's own `@Controller('users')` path, read rather than restated. */
function metadata(key: string, target: object): unknown {
  return Reflect.getMetadata(key, target) as unknown;
}

/**
 * Class → its file in `src/users/`.
 *
 * §F1's "file name matches the class name" is a camelCase/PascalCase file naming rule,
 * and these classes are named for their DTO rather than their route — `user-profile.dto.ts`
 * declares `UserProfileDto` — so the file name cannot be derived from the class name.
 * Written out here instead, which is also the honest answer: a mapping inferred by
 * string surgery would quietly return the wrong file the day a class is renamed.
 */
const DTO_FILE: Readonly<Record<string, string>> = {
  UserProfileDto: 'user-profile.dto.ts',
  UpdateProfileDto: 'update-profile.dto.ts',
  EmailChangeRequestDto: 'email-change-request.dto.ts',
  EmailChangeConfirmDto: 'email-change-confirm.dto.ts',
  ChangePasswordDto: 'change-password.dto.ts',
  CreateUserDto: 'create-user.dto.ts',
};

function handlerOf(handlerName: string): object {
  const handler = (UsersController.prototype as unknown as Record<string, unknown>)[handlerName];
  if (typeof handler !== 'function') {
    throw new Error(`UsersController has no handler named ${handlerName}`);
  }
  return handler;
}

/**
 * The field names a DTO class DECLARES, read from its source file.
 *
 * ## WHY THE SOURCE AND NOT THE CLASS
 *
 * A TypeScript field declaration without an initializer is erased: with the ES2022 class
 * fields this project targets, `first_name: string` is written onto the INSTANCE at
 * construction and exists on the prototype not at all, so `Object.getOwnPropertyNames(
 * Dto.prototype)` sees only methods and accessors. Two ways round that were rejected:
 * instantiating the DTO and reading `Object.keys(instance)` sees only the fields some
 * other test happened to assign, and the TypeScript compiler API would make a wire-shape
 * assertion depend on a type checker.
 *
 * So the declaration is read as text, with comments stripped first — otherwise a field
 * named in a docstring (`first_name` appears in several of these comments, including this
 * file's) would be counted. This is the same technique `test/unit/claims-write-surface.spec.ts`
 * and `test/unit/schema-drift.spec.ts` use, and for the same reason: the thing being
 * asserted is a payload inside a string, and a payload has to be read as text.
 */
function declaredProperties(fileName: string): readonly string[] {
  const source = stripComments(
    readFileSync(new URL(`../../../src/users/${fileName}`, import.meta.url), 'utf8'),
  );
  const names: string[] = [];
  for (const line of source.split('\n')) {
    // Two-space indent, a lowercase name, an optional `?`, then a type annotation. The
    // indent is what keeps a parameter or a local out of the result, and the lowercase
    // requirement is §B1's rule stated as a filter.
    const field = /^ {2}([a-z][a-z0-9_]*)\??:/.exec(line);
    if (field?.[1] !== undefined) {
      names.push(field[1]);
    }
  }
  return names;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('//');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}

/**
 * The keys `@ApiProperty` was applied to, read from the metadata it writes at
 * class-definition time.
 *
 * AGENTS.md §B3: "`@ApiProperty()` on every DTO field, without exception." Reading the
 * metadata rather than the text means a decorator that was commented out, misspelled or
 * attached to the wrong field cannot pass — which is the whole point of asserting it.
 * The key is `'swagger/apiModelPropertiesArray'`, the constant
 * `DECORATORS.API_MODEL_PROPERTIES_ARRAY` in `@nestjs/swagger`.
 */
function apiPropertyKeys<T extends object>(dto: { new (): T; readonly prototype: T }): readonly string[] {
  const keys = metadata('swagger/apiModelPropertiesArray', dto.prototype);
  if (!Array.isArray(keys)) {
    return [];
  }
  return keys.map((key) => String(key).replace(/^:/, '')).sort();
}

describe('the seven /users routes are mounted where the contract says they are', () => {
  const ROUTES = [
    // GET carries no `@HttpCode`: Nest's default for GET is 200, and `AuthController.me`
    // is left the same way — an implicit default is a number nobody chose, and the point
    // is that it is the framework's rather than a retyped literal.
    { handler: 'me', path: 'me', method: RequestMethod.GET, status: undefined },
    { handler: 'update_me', path: 'me', method: RequestMethod.PATCH, status: 200 },
    { handler: 'request_email_change', path: 'me/email', method: RequestMethod.POST, status: 202 },
    { handler: 'confirm_email_change', path: 'me/email/confirm', method: RequestMethod.POST, status: 200 },
    { handler: 'change_password', path: 'me/password', method: RequestMethod.POST, status: 204 },
    { handler: 'login_attempts', path: 'me/login-attempts', method: RequestMethod.GET, status: undefined },
    { handler: 'create', path: '/', method: RequestMethod.POST, status: undefined },
  ] as const;

  it('is mounted under /users, and each handler is on the method and status the contract names', () => {
    expect(metadata(PATH_METADATA, UsersController)).toBe('users');
    for (const route of ROUTES) {
      const handler = handlerOf(route.handler);
      expect(metadata(PATH_METADATA, handler), route.handler).toBe(route.path);
      expect(metadata(METHOD_METADATA, handler), route.handler).toBe(route.method);
      // `create` states nothing: Nest's default for POST is 201, and the controller's
      // comment says an implicit default is a number nobody chose — so the assertion is
      // that it really is left to the framework, which is 201, and the contract's 201.
      expect(metadata(HTTP_CODE_METADATA, handler), route.handler).toBe(route.status);
    }
  });

  it('names every route in the dispatch vocabulary, because an unnamed route stops the boot', () => {
    for (const route of ROUTES) {
      const token = dispatchTokenForRoute('UsersController', route.handler);
      expect(token, `UsersController.${route.handler} names no dispatch token`).toBe(
        `users.${route.handler}`,
      );
      expect(KNOWN_DISPATCH_TOKENS).toContain(token);
    }
    // …and no two routes share one token, because a shared token would make two routes
    // a single dispatch decision under memory pressure.
    const tokens = ROUTES.map((route) => dispatchTokenForRoute('UsersController', route.handler));
    expect(new Set(tokens).size).toBe(ROUTES.length);
  });

  it('protects six of the seven by the ABSENCE of @Public(), which is the direction that fails safely', () => {
    // The global JwtAuthGuard is default deny (§B5), so a handler without `@Public()` is
    // unreachable rather than merely unprotected. The one route that opts out is the
    // address-change confirmation, and it has to: the token IS its authentication.
    for (const route of ROUTES) {
      const isPublic = metadata(IS_PUBLIC_KEY, handlerOf(route.handler));
      expect(isPublic === true, `${route.handler} is ${isPublic === true ? 'public' : 'protected'}`).toBe(
        route.handler === 'confirm_email_change',
      );
    }
  });
});

describe('the self-read DTO is exactly the twelve columns of the member grant', () => {
  /**
   * `0023_user_profile_and_disable.sql:687-692` grants `app_member`:
   *   id, username, email, created_at, country_code, region_code, city, geo_source,
   *   geo_accuracy_km, geo_updated_at, first_name, last_name
   *
   * The frontend's `ProfileMe` is a `Pick` of exactly those twelve out of the generated
   * schema, so a thirteenth field here is a shape the generated type does not describe —
   * and, because the read runs under the member's own role, a column outside the grant
   * fails the WHOLE read rather than being quietly omitted.
   */
  const GRANT = [
    'city',
    'country_code',
    'created_at',
    'email',
    'first_name',
    'geo_accuracy_km',
    'geo_source',
    'geo_updated_at',
    'id',
    'last_name',
    'region_code',
    'username',
  ];

  it('declares those twelve and nothing else', () => {
    expect([...declaredProperties(DTO_FILE[UserProfileDto.name])].sort()).toEqual(GRANT);
  });

  it('carries @ApiProperty on every one of them, because a field without it is absent from the document', () => {
    // §B3: "@ApiProperty() on every DTO field, without exception". Read from the
    // metadata the Swagger CLI plugin writes rather than from the source text, so a
    // decorator that was commented out or misspelled cannot pass.
    expect(apiPropertyKeys(UserProfileDto)).toEqual(GRANT);
  });

  it('names them in snake_case, because there is no client key transform anywhere (§B1)', () => {
    // A camelCase property here would be a field the frontend never sees, because there
    // is nothing to translate it — and §B1 forbids a runtime transform outright, since it
    // rewrites keys inside `jsonb` and corrupts passthrough payloads.
    for (const name of declaredProperties(DTO_FILE[UserProfileDto.name])) {
      expect(name, `${name} is not snake_case`).toBe(name.toLowerCase());
    }
  });

  it('withholds the columns a member may not read, rather than publishing them as null', () => {
    const published = new Set(declaredProperties(DTO_FILE[UserProfileDto.name]));
    for (const forbidden of [
      'password_hash',
      'last_login_at',
      'last_activity_at',
      'email_verified_at',
      'deleted_at',
      'deletion_reason',
      'email_anonymized',
      'disabled_at',
      'disabled_by',
      'disabled_reason',
      'disabled_until',
    ]) {
      expect(published.has(forbidden), `${forbidden} is readable by nobody and must not be published`).toBe(false);
    }
  });
});

describe('the name-write body refuses the fields a member may not write', () => {
  it('takes first_name and last_name and nothing else', async () => {
    expect([...declaredProperties(DTO_FILE[UpdateProfileDto.name])].sort()).toEqual(['first_name', 'last_name']);

    // The global pipe is `{ whitelist: true, forbidNonWhitelisted: true }`, so each of
    // these is a 400 naming the field. That is the answer a client wants; the alternative
    // — accepting them and ignoring them — is §2.1's silent no-op.
    for (const forbidden of [
      { id: '1f0a4a2e-0000-4000-8000-000000000001' },
      { username: 'someone-else' },
      { email: 'attacker@example.test' },
      { created_at: '2020-01-01T00:00:00Z' },
      { password_hash: 'x' },
      { geo_accuracy_km: 12 },
    ]) {
      // `whitelist` and `forbidNonWhitelisted` are PIPE options, so they are passed to
      // `validate` here rather than being assumed — otherwise this assertion would be
      // measuring nothing, because plain `validate()` ignores unknown properties
      // entirely and would report zero errors for a body full of columns the route
      // refuses to write.
      const errors = await validate(plainToInstance(UpdateProfileDto, forbidden), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.length, `${JSON.stringify(forbidden)} was accepted`).toBeGreaterThan(0);
    }
  });

  it('accepts a missing field, a null and a value — because null clears and absence is not a change', async () => {
    // Both columns are nullable and NULL is the schema's own word for "nobody stated a
    // name". `''` is a different thing and is refused by the DATABASE, which
    // `UsersService.updateMe` maps to a 422 — so this DTO must not pre-empt that with a
    // 400, or the two would give different answers for one mistake.
    for (const accepted of [
      {},
      { first_name: 'Ada' },
      { last_name: 'Lovelace' },
      { first_name: null },
      { last_name: null },
      { first_name: 'Ada', last_name: 'Lovelace' },
    ]) {
      const errors = await validate(plainToInstance(UpdateProfileDto, accepted));
      expect(errors, `${JSON.stringify(accepted)} was refused for a reason that is not the database's`).toEqual([]);
    }
  });
});

describe('the address-change request takes one field, and it is the address they want NEXT', () => {
  it('is exactly `email`, with no current address and no subject', () => {
    expect([...declaredProperties(DTO_FILE[EmailChangeRequestDto.name])]).toEqual(['email']);
  });

  it('refuses a malformed address with a 400 that is a statement about format only', async () => {
    // The caller is already authenticated and already knows their own account, so there
    // is no enumeration argument on this route for a format refusal to weaken — every
    // account's owner knows their own address.
    for (const garbage of ['not-an-address', 'a@b', 'two words@example.test', 'x@example.test\nBcc: v@e.test']) {
      const errors = await validate(plainToInstance(EmailChangeRequestDto, { email: garbage }));
      expect(errors.some((error) => error.property === 'email'), `'${garbage}' was accepted`).toBe(true);
    }
  });
});

describe('a wrong current_password is refused by validation as nothing, and by the route as a 422', () => {
  it('carries `current_password` and `new_password` in snake_case, because the wire is snake_case', async () => {
    // §B1 and the frontend's hand-written mirror `password-change-request.ts`. There is
    // no client key transform, so the DTO's property names ARE the wire names; a
    // camelCase spelling here would be a body the client never sends.
    expect([...declaredProperties(DTO_FILE[ChangePasswordDto.name])].sort()).toEqual(['current_password', 'new_password']);
    expect(
      await validate(plainToInstance(ChangePasswordDto, { current_password: 'old-one', new_password: 'new-one' })),
    ).toEqual([]);
  });

  it('accepts an EMPTY current_password so the credential failure is not pre-empted by a 400', async () => {
    // This is the subtle one. A `MinLength(1)` on `current_password` would answer "you
    // sent an empty string" with a 400 while a wrong non-empty password gets a 422 —
    // two outcomes for one mistake on a route whose response IS the feedback, and the
    // frontend renders a 422 with the server's reason and a 400 as a bare status.
    // An empty string goes to bcrypt and is answered as the credential failure it is.
    expect(await validate(plainToInstance(ChangePasswordDto, { current_password: '', new_password: 'new-one' }))).toEqual([]);
  });

  it('applies the reset path\'s rule to the new password, and does not invent one for the current', async () => {
    // The same rule, read from `src/common/password-policy.ts`, so the two routes that
    // set a password cannot drift: a value one accepts and the other refuses is a
    // support ticket, and both answers are "success", so the drift is invisible.
    for (const candidate of ['', 'x', 'x'.repeat(1024), 'x'.repeat(1025)]) {
      const errors = await validate(
        plainToInstance(ChangePasswordDto, { current_password: 'old-one', new_password: candidate }),
      );
      const onNew = errors.some((error) => error.property === 'new_password');
      const onReset = (
        await validate(plainToInstance(PasswordResetConfirmDto, { token: 'a'.repeat(43), password: candidate }))
      ).some((error) => error.property === 'password');
      expect(onNew, `new_password=${String(candidate.length)} chars disagreed with the reset path`).toBe(onReset);
    }
  });

  it('has no @HttpCode(401) anywhere near it, because 401 means the TOKEN was refused', () => {
    // The frontend's authInterceptor clears the session and navigates to /access-denied
    // on a 401 for a request that carried a token. Asserted here as a property of the
    // route's decorator so the answer is read from the code rather than remembered.
    expect(metadata(HTTP_CODE_METADATA, handlerOf('change_password'))).toBe(204);
  });
});

describe('the administrator body names the five contract fields and refuses a shell of an address', () => {
  it('is exactly the five, in snake_case', () => {
    expect([...declaredProperties(DTO_FILE[CreateUserDto.name])].sort()).toEqual([
      'email',
      'first_name',
      'last_name',
      'password',
      'username',
    ]);
  });

  it('refuses a username that is not a login name, before it reaches a row', async () => {
    // A newline or a NUL in a login name is a payload-corruption surface for every
    // header and log line that later carries it. The pattern is a sanity bound and not a
    // naming policy — §B2 has no username vocabulary and this route must not invent one.
    for (const bad of ['', ' leading-space', 'has space', 'has\nnewline', 'ünïcode-only', 'a'.repeat(256)]) {
      const errors = await validate(
        plainToInstance(CreateUserDto, { username: bad, email: 'a@example.test', password: 'p' }),
      );
      expect(errors.some((error) => error.property === 'username'), `'${bad}' was accepted`).toBe(true);
    }
    for (const good of ['jane', 'jane.doe', 'jane_doe-99']) {
      const errors = await validate(
        plainToInstance(CreateUserDto, { username: good, email: 'a@example.test', password: 'p' }),
      );
      expect(errors, `'${good}' was refused`).toEqual([]);
    }
  });
});

describe('the composite address-change token carries the address and cannot be swapped', () => {
  /**
   * The whole design in one place: the pending address lives in the token's own value,
   * inside the string `TokenService.hashToken` HMACs. So it is authenticated — a
   * caller cannot present a token for one address and have it apply to another — and it
   * is stored nowhere, which is what removes the need for a column on `users`.
   */
  const SECRET = 'A'.repeat(43);

  function encode(address: string): string {
    // Reproducing the codec's own construction from outside it, deliberately: a test
    // that called `encodeEmailChangeToken` to produce the value it then decoded would
    // pass against a codec whose encode and decode agreed and whose payload meant
    // nothing. The payload is built here by hand, so "the address survives the round
    // trip" is a statement about the FORMAT rather than about a function agreeing with
    // itself.
    const payload = Buffer.from(address, 'utf8').toString('base64url');
    return `${EMAIL_CHANGE_TOKEN_PREFIX}${payload}.${SECRET}`;
  }

  it('round-trips the address through base64url, including one with + and = in the local part', () => {
    for (const address of [
      'new-address@example.test',
      'weird+tag=ish@sub.example.test',
      'üñï@example.test',
      `${'x'.repeat(MAX_PENDING_EMAIL_LENGTH - 7)}@e.test`,
    ]) {
      const raw = encode(address);
      expect(readEmailChangeToken(raw), address).toBe(address);
    }
  });

  it('normalises the address the same way every write of it does, so the address applied is the address verified', () => {
    // `normalizePendingEmail` is applied at mint time and its result is what goes into
    // the token, so `users.email` cannot end up holding a spelling the verification did
    // not commit to.
    expect(normalizePendingEmail('  New@Example.Test  ')).toBe('new@example.test');
  });

  it('is refused by the bare redemption path BEFORE any database call, which is what stops it consuming a live link', () => {
    // `auth_tokens.purpose` cannot name `email_change` without a migration, so an
    // address-change row and a verification row are the same purpose to
    // `authz.redeem_auth_token`. `TokenService.redeem` refuses a composite value in
    // `isPlausibleRawToken`, so `POST /auth/email-verification/confirm` cannot consume
    // one — and therefore cannot silently destroy a pending change while reporting a
    // success that describes a different fact.
    expect(COMPOSITE_TOKEN_PREFIXES).toContain(EMAIL_CHANGE_TOKEN_PREFIX);
    expect(encode('new-address@example.test').startsWith(EMAIL_CHANGE_TOKEN_PREFIX)).toBe(true);
  });

  it('refuses a bare token, a mangled payload and a wrong-shaped secret, all with the same answer', () => {
    // One `null` for every failure, because a caller who learns WHICH kind of wrong
    // their link was has learned something about a link whose validity is the thing
    // being protected.
    const bare = SECRET;
    // A payload with a character outside the base64url alphabet. `Buffer.from(x,
    // 'base64url')` silently DROPS such a character, so this decodes to the same bytes as
    // `abcd` would — which is exactly why the parser re-encodes and compares, and why a
    // lenient decode would let two different raw values claim one address.
    const notCanonical = `${EMAIL_CHANGE_TOKEN_PREFIX}ab$cd.${SECRET}`;
    // Three segments: the format is `ec1.<payload>.<secret>` and nothing else.
    const tooManySegments = `${EMAIL_CHANGE_TOKEN_PREFIX}YWJjZA.YWJjZA.${SECRET}`;
    const shortSecret = `${EMAIL_CHANGE_TOKEN_PREFIX}YWJjZA.${'A'.repeat(42)}`;

    for (const rejected of [bare, notCanonical, tooManySegments, shortSecret, '', 'ec1.']) {
      expect(readEmailChangeToken(rejected), JSON.stringify(rejected)).toBeNull();
    }
  });

  it('gives the confirm DTO the codec\'s CEILING and NO FLOOR, so one mistake has one answer', () => {
    // The pattern of `PasswordResetConfirmDto`: a DTO narrower than the primitive turns
    // one uniform "that link is not valid" into two distinguishable answers.
    //
    // The DTO's own source is read here, because the assertion is about which NUMBERS
    // the DTO names and not that they are close.
    //
    // The CEILING is shared, and must be: a body carrying an enormous string is a
    // malformed body, and 400 is the right answer for that. It exceeds the BARE token's
    // 256, which is the whole reason the DTO cannot reuse `PasswordResetConfirmDto`'s
    // window — a 255-byte address encodes to 340 base64url characters on its own.
    //
    // There is NO FLOOR, and that is the fix rather than an omission. A bare
    // email-verification token is SHORTER than the shortest composite email-change
    // token, so `@MinLength(EMAIL_CHANGE_TOKEN_MIN_LENGTH)` refused a perfectly
    // well-formed token of the wrong kind with 400 — while the codec answers 422 for a
    // token it cannot use. Two answers for one mistake, and the e2e suite caught it:
    // the "keeps the two token flows apart" case was getting 400 where the route's own
    // docstring says 422.
    //
    // So the lower end belongs to the primitive, which refuses anything outside the
    // window before it touches the database, and the DTO keeps only a body-size bound.
    const source = stripComments(
      readFileSync(new URL('../../../src/users/email-change-confirm.dto.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain('EMAIL_CHANGE_TOKEN_MAX_LENGTH');
    expect(EMAIL_CHANGE_TOKEN_MAX_LENGTH).toBeGreaterThan(256);
    expect(source).not.toContain('MinLength');
    expect(source).not.toContain('EMAIL_CHANGE_TOKEN_MIN_LENGTH');
    // The primitive still owns BOTH ends — the DTO's silence about the floor must not
    // have narrowed it, or a short token would now reach the database.
    expect(EMAIL_CHANGE_TOKEN_MIN_LENGTH).toBeLessThan(EMAIL_CHANGE_TOKEN_MAX_LENGTH);
    expect(readEmailChangeToken('ec1.')).toBeNull();
    expect(readEmailChangeToken('short')).toBeNull();
  });

  it('keys the supersede on the member rather than on the address, because the address is what is unknown', () => {
    // `invalidate_auth_tokens` matches on `subject_hmac`, so the subject has to be
    // something the superseding request already knows. The pending address is exactly
    // the one thing it does not — and it is stored nowhere, which is the point.
    expect(emailChangeSubject('01a14124-0000-4000-8000-000000000001')).toBe(
      'email-change:01a14124-0000-4000-8000-000000000001',
    );
    // And it cannot collide with a verification token's subject, which is the lowercased
    // address: a registered address equal to `email-change:<uuid>` has no `@` in it.
    expect(emailChangeSubject('01a14124-0000-4000-8000-000000000001')).not.toContain('@');
  });

  it('bounds the confirm DTO on the composite window, not the bare one', async () => {
    const longest = `${'x'.repeat(MAX_PENDING_EMAIL_LENGTH - 7)}@e.test`;
    const atLimit = encode(longest);
    expect(atLimit.length).toBeLessThanOrEqual(EMAIL_CHANGE_TOKEN_MAX_LENGTH);
    expect(await validate(plainToInstance(EmailChangeConfirmDto, { token: atLimit }))).toEqual([]);

    const overLimit = encode(`${longest}.extra`);
    expect(
      (await validate(plainToInstance(EmailChangeConfirmDto, { token: overLimit }))).length,
    ).toBeGreaterThan(0);
  });
});
