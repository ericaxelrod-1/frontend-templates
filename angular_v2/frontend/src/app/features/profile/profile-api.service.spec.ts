import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { lastValueFrom } from 'rxjs';
import { ProfileApi } from './profile-api.service';

/**
 * The five `/users/me` routes, asserted on the wire.
 *
 * `HttpTestingController` rather than a stubbed collaborator, because what matters
 * about these calls is the request the BROWSER makes: the path, the method and the
 * body. A stubbed `HttpClient` would assert that this service calls itself.
 */
describe('ProfileApi', () => {
  let api: ProfileApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ProfileApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the caller’s own row from the thin app, same-origin', async () => {
    const row = { id: 'u1', username: 'ada', email: 'ada@example.org', created_at: '2026-01-05T09:00:00.000Z' };
    const read = lastValueFrom(api.me());

    const request = http.expectOne('/api/users/me');

    expect(request.request.method).toBe('GET');
    request.flush(row);
    await expect(read).resolves.toEqual(row);
  });

  /**
   * The body is exactly the two editable columns. It is derived from the generated
   * `users` type, so `username`, `id` and `created_at` cannot creep in — each would
   * be a property the grant does not cover and a `422` from `forbidNonWhitelisted`.
   */
  it('patches only the name columns, and returns the refreshed row', async () => {
    const saved = lastValueFrom(api.updateMe({ first_name: 'Ada', last_name: 'Lovelace' }));

    const request = http.expectOne('/api/users/me');

    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ first_name: 'Ada', last_name: 'Lovelace' });
    expect(Object.keys(request.request.body as object)).not.toContain('username');
    request.flush({
      id: 'u1',
      username: 'ada',
      email: 'a@b.c',
      created_at: '2026-01-05T09:00:00.000Z',
      first_name: 'Ada',
      last_name: 'Lovelace',
    });
    // The refreshed row, not an echo of the request: the page renders what the
    // SERVER stored, which is the whole reason the response is the row.
    await expect(saved).resolves.toMatchObject({ first_name: 'Ada', username: 'ada' });
  });

  it('asks for an email change, and reads the 202 as an acceptance', async () => {
    const accepted = lastValueFrom(api.requestEmailChange({ email: 'new@example.org' }));

    const request = http.expectOne('/api/users/me/email');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'new@example.org' });
    request.flush({ accepted: true }, { status: 202, statusText: 'Accepted' });
    await expect(accepted).resolves.toEqual({ accepted: true });
  });

  it('changes the password with both fields, and treats 204 as done', async () => {
    const changed = lastValueFrom(
      api.changePassword({ current_password: 'old-one', new_password: 'new-one' }),
    );

    const request = http.expectOne('/api/users/me/password');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      current_password: 'old-one',
      new_password: 'new-one',
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await expect(changed).resolves.toBeNull();
  });

  /**
   * The history comes from a dedicated route and not from PostgREST. A member holds
   * no column grant on `login_attempts` and no RLS scope that would admit a read of
   * it, so `GET /rest/login_attempts` would be `403` — and the one that works is the
   * thin app resolving the caller's own username.
   */
  it('reads the caller’s own sign-in history from its own route', async () => {
    const history = lastValueFrom(api.loginAttempts());

    const request = http.expectOne('/api/users/me/login-attempts');

    expect(request.request.method).toBe('GET');
    request.flush([
      {
        id: 'a1',
        ip: '198.51.100.7',
        status: 'failed',
        attempt_kind: 'login',
        created_at: '2026-02-01T08:30:00.000Z',
        ip_subnet: '198.51.100.0/24',
      },
    ]);
    await expect(history).resolves.toHaveLength(1);
  });

  /**
   * None of these failures is converted into a success-shaped value. A `403` here is
   * the column grant or the RLS scope refusing, and swallowing it would render as
   * "your account has none of these" — the AGENTS.md §2.3 failure mode.
   */
  it('propagates 401, 403 and 422 to the caller instead of resolving', async () => {
    for (const status of [401, 403, 422]) {
      const read = lastValueFrom(api.me());
      http.expectOne('/api/users/me').flush('refused', { status, statusText: 'Refused' });
      await expect(read).rejects.toBeInstanceOf(HttpErrorResponse);
    }
  });

  it('reports a route that does not exist yet as a 404 rather than as empty data', async () => {
    const read = lastValueFrom(api.me());
    http.expectOne('/api/users/me').flush('Not Found', { status: 404, statusText: 'Not Found' });

    await expect(read).rejects.toMatchObject({ status: 404 });
  });
});