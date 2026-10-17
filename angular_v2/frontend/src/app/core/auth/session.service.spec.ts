import { Component, ErrorHandler, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, throwError } from 'rxjs';
import type { AuthLoginRequest, AuthMe, AuthTokens } from './auth.types';
import { AuthApi } from './auth-api.service';
import { Session } from './session.service';

const STORAGE_KEY = 'angular_v2.session.v1';

function tokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  return {
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    tokenType: 'Bearer',
    expiresIn: 900,
    ...overrides,
  };
}

/**
 * A hand-written stand-in for `AuthApi`, so these tests exercise `Session`'s own
 * decisions — what it remembers, what it forgets, and in what order — without a
 * server. Permitted in `*.spec.ts` only (AGENTS.md §2.2). It is not a mock of the
 * database and no production code depends on it.
 */
class AuthApiStub {
  readonly meResponses = new Subject<AuthMe>();

  loginCalls: AuthLoginRequest[] = [];
  logoutCalls: { refreshToken: string }[] = [];

  /** Set to make the next `logout` fail, exercising the documented ordering. */
  logoutFailure: Error | null = null;

  login(request: AuthLoginRequest): Observable<AuthTokens> {
    this.loginCalls.push(request);
    return new Observable((subscriber) => {
      subscriber.next(tokens());
      subscriber.complete();
    });
  }

  me(): Observable<AuthMe> {
    return this.meResponses.asObservable();
  }

  logout(request: { refreshToken: string }): Observable<void> {
    this.logoutCalls.push(request);
    return this.logoutFailure === null
      ? new Observable((subscriber) => subscriber.complete())
      : throwError(() => this.logoutFailure);
  }
}

/**
 * `Session.identity` is an `rxResource`, and a resource only subscribes inside a
 * live reactive context. Injecting the service directly leaves nothing to run the
 * effect, so the stream never subscribes and the stub's `Subject` has no
 * subscriber. Hosting the service in a component gives it that context.
 */
@Component({ selector: 'session-host', template: '' })
class SessionHost {
  readonly session = inject(Session);
}

describe('Session', () => {
  let api: AuthApiStub;
  let reported: unknown[];

  /** Captures what `Session` hands to `ErrorHandler`, so it can be asserted on. */
  class RecordingErrorHandler extends ErrorHandler {
    override handleError(error: unknown): void {
      reported.push(error);
    }
  }

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    reported = [];
    api = new AuthApiStub();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthApi, useValue: api },
        { provide: ErrorHandler, useClass: RecordingErrorHandler },
      ],
    });
  });

  it('starts signed out when nothing is stored', () => {
    const session = TestBed.inject(Session);

    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
    expect(session.userId()).toBeNull();
  });

  it('remembers the tokens returned by a successful sign-in', () => {
    const session = TestBed.inject(Session);

    session.login({ username: 'ada', password: 'secret' }).subscribe();

    expect(api.loginCalls).toEqual([{ username: 'ada', password: 'secret' }]);
    expect(session.isAuthenticated()).toBe(true);
    expect(session.accessToken()).toBe('access-token-value');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(tokens());
  });

  it('exposes the identity reported by the API', async () => {
    const fixture = TestBed.createComponent(SessionHost);
    const session = fixture.componentInstance.session;
    session.login({ username: 'ada', password: 'secret' }).subscribe();
    // Flush so the resource's params change and it subscribes to the stream.
    // `tick()` runs effects synchronously but the resource settles on a
    // microtask, so the queue is yielded explicitly afterwards.
    TestBed.tick();
    await Promise.resolve();

    api.meResponses.next({ sub: 'user-uuid', role: 'app_admin', expiresIn: 900 });
    TestBed.tick();
    await Promise.resolve();

    expect(session.userId()).toBe('user-uuid');
    expect(session.databaseRole()).toBe('app_admin');
  });

  /**
   * `JSON.parse` succeeds on anything, so a hand-edited or truncated entry must
   * never be attached to a request as `Bearer hello` — it is discarded instead.
   */
  it('discards a stored value that is not a token pair', () => {
    localStorage.setItem(STORAGE_KEY, '"hello"');

    const session = TestBed.inject(Session);

    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards a stored value missing either half of the pair', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: 'only-the-access-token' }));

    const session = TestBed.inject(Session);

    expect(session.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('revokes the refresh token it was holding when signing out', () => {
    const session = TestBed.inject(Session);
    session.login({ username: 'ada', password: 'secret' }).subscribe();

    session.logout();

    expect(api.logoutCalls).toEqual([{ refreshToken: 'refresh-token-value' }]);
  });

  /**
   * The ordering is the behaviour: a person who asked to be signed out is signed
   * out, and a network failure revoking the token must not leave them apparently
   * still signed in. The failure is reported through `ErrorHandler` rather than
   * left as an unhandled rejection that reaches nobody.
   */
  it('clears the local session and reports a failed revocation', () => {
    api.logoutFailure = new Error('network unreachable');
    const session = TestBed.inject(Session);
    session.login({ username: 'ada', password: 'secret' }).subscribe();

    expect(() => session.logout()).not.toThrow();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe('network unreachable');
  });

  it('does not attempt revocation when there was no session to end', () => {
    const session = TestBed.inject(Session);

    session.logout();

    expect(api.logoutCalls).toEqual([]);
  });

  it('forgets everything on clear', () => {
    const session = TestBed.inject(Session);
    session.login({ username: 'ada', password: 'secret' }).subscribe();

    session.clear();

    expect(session.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});