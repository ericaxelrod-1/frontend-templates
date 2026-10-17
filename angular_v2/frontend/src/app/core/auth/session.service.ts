import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  DestroyRef,
  ErrorHandler,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, type Observable, tap } from 'rxjs';
import type { AuthLoginRequest, AuthTokens } from './auth.types';
import { AuthApi } from './auth-api.service';

/**
 * The single owner of session state. Tokens and identity live here as signals
 * and nowhere else — no store library, no second copy in a component (AGENTS.md
 * §F3). `AuthApi` performs the HTTP; this service decides what is remembered.
 *
 * ## Where the tokens live, and why
 *
 * `localStorage`, and only ever read and written behind `isPlatformBrowser`.
 *
 * The alternative in a browser application is an `HttpOnly` cookie. It is the
 * better answer in general, and it is NOT available here, for two reasons that
 * are visible in this repository rather than hypothetical:
 *
 * 1. **Nothing reads a cookie.** The CRUD layer is PostgREST, which authenticates
 *    from an `Authorization: Bearer` header it derives from the verified JWT; it
 *    reads no cookie, and `postgrest.conf` sets none. A cookie would have to be
 *    read by JavaScript and re-attached as a header, which gives up the `HttpOnly`
 *    protection while keeping the XSS-readable token — strictly worse than
 *    `localStorage`.
 * 2. **There is no backend-for-frontend to translate one.** Translating the
 *    cookie into the header is a mechanism this template does not have, and
 *    inventing one to hold a token is not a decision to make inside a first
 *    vertical slice. The trade this records: a token in `localStorage` is readable
 *    by any script the page loads, so it depends on the page not loading
 *    untrusted script. The upgrade path is a BFF that sets an `HttpOnly`,
 *    `Secure`, `SameSite=Strict` cookie and mints the PostgREST bearer itself.
 *
 * ## Why the server render is anonymous, and why that is fine
 *
 * The Node process has no session: `localStorage` is per-browser and there is no
 * cookie to read, so `isAuthenticated()` is `false` during SSR and the token is
 * never touched on the server. Rather than let a server render disagree with the
 * browser — which hydration reports as a hard error — the authenticated area is
 * declared `RenderMode.Client` in `app.routes.server.ts`, so the server is never
 * asked to render it. The public routes are server-rendered and genuinely public.
 *
 * ## Why the restore is synchronous
 *
 * The stored tokens are read in a field initialiser, not in a constructor that
 * performs IO, because `localStorage` reads synchronously. The access token is
 * therefore populated before the first route guard runs, so a deep link into the
 * authenticated area does not bounce through `/login` and back on every reload.
 */

const STORAGE_KEY = 'angular_v2.session.v1';

@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(AuthApi);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errors = inject(ErrorHandler);

  private readonly tokens = signal<AuthTokens | null>(this.readStoredTokens());

  /**
   * The signed-in identity, from `GET /auth/me`.
   *
   * It is a resource keyed on the tokens rather than a second writable signal, so
   * there is exactly one write path (`login`) and exactly one clear path
   * (`clear`). A `401` here is the API rejecting the token itself, which
   * `authInterceptor` treats as an invalid session: it clears the tokens, this
   * resource's params become `null`, the stream returns `EMPTY` and nothing is
   * re-requested.
   */
  private readonly identity = rxResource({
    params: () => this.tokens(),
    stream: ({ params }) => (params === null ? EMPTY : this.api.me()),
  });

  /** Whether a token is held. Synchronous, so the guard can trust it. */
  readonly isAuthenticated = computed(() => this.tokens() !== null);

  /** The bearer presented on every API call, or `null` when signed out. */
  readonly accessToken = computed(() => this.tokens()?.accessToken ?? null);

  /** The database role the token carries — `app_member`, `app_admin`, … */
  readonly databaseRole = computed(() => this.identity.value()?.role ?? null);

  /** The subject claim: the user's `users.id`. */
  readonly userId = computed(() => this.identity.value()?.sub ?? null);

  /**
   * Signs in and remembers the tokens. The identity request follows on its own,
   * because it is keyed on the tokens this writes.
   */
  login(request: AuthLoginRequest): Observable<AuthTokens> {
    return this.api.login(request).pipe(tap((tokens) => this.store(tokens)));
  }

  /**
   * Ends the session.
   *
   * Local state is cleared FIRST and unconditionally: the person asked to be
   * signed out, and leaving them apparently signed in because a network call
   * failed is the wrong failure to have. The revocation that follows is what
   * makes the refresh token unusable (AGENTS.md §B5 — logout must actually
   * invalidate it). If it fails the error is not swallowed: it is handed to
   * `ErrorHandler` explicitly, because an RxJS subscription with no error callback
   * does not reach `ErrorHandler` — it surfaces on the *global* error handler,
   * which reports it to nobody and cannot be asserted on (AGENTS.md §2.3).
   */
  logout(): void {
    const refreshToken = this.tokens()?.refreshToken;
    this.clear();
    if (refreshToken === undefined) {
      return;
    }
    this.api
      .logout({ refreshToken })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (cause: unknown) => this.errors.handleError(cause) });
  }

  /** Drops every trace of the session. The one place tokens are forgotten. */
  clear(): void {
    this.tokens.set(null);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private store(tokens: AuthTokens): void {
    this.tokens.set(tokens);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    }
  }

  /**
   * `null` on the server, and `null` for a stored value that cannot be read —
   * an entry this build cannot parse is removed rather than left to fail on
   * every load. A hand-edited or truncated entry is a broken checkout, not a
   * condition with a user-facing meaning, so it is repaired rather than reported.
   */
  private readStoredTokens(): AuthTokens | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return isAuthTokens(parsed) ? parsed : this.discardStoredTokens();
  }

  /**
   * A member rather than a module-level function so the `localStorage` reference
   * stays behind the `isPlatformBrowser` check in `readStoredTokens`. A free
   * function reaching `localStorage` unguarded is exactly the shape AGENTS.md §F6
   * prohibits — harmless until something calls it from a path that runs on the
   * server, at which point it is a crash in production code.
   */
  private discardStoredTokens(): null {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * The structural check a value from `localStorage` needs before it is used as a
 * token. `JSON.parse` succeeds on anything, so without this a stored `"hello"`
 * would be attached to every request as `Bearer hello`.
 */
function isAuthTokens(value: unknown): value is AuthTokens {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof AuthTokens, unknown>>;
  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken !== '' &&
    typeof candidate.refreshToken === 'string' &&
    candidate.refreshToken !== ''
  );
}