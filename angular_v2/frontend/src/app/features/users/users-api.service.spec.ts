import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  columnScopeFor,
  UsersApi,
  type GroupNamesByUserId,
  type RoleNamesByUserId,
  type UsersRow,
} from './users-api.service';

/**
 * What a column list the browser may name looks like.
 *
 * Read this as the deliverable: it is every column of `users` except the one that
 * must never be requested. `password_hash` is a credential artifact, not data about
 * a user, and it appears in neither scope's `select` — the member scope because the
 * grant does not hold it, the admin scope because asking for it would hand every
 * hash in the table to a page that renders names.
 */
const ADMIN_COLUMNS = [
  'id',
  'username',
  'email',
  'created_at',
  'first_name',
  'last_name',
  'last_login_at',
  'last_activity_at',
  'email_verified_at',
  'deleted_at',
  'deletion_reason',
  'email_anonymized',
  'country_code',
  'region_code',
  'city',
  'geo_source',
  'geo_accuracy_km',
  'geo_updated_at',
  'disabled_at',
  'disabled_by',
  'disabled_reason',
  'disabled_until',
];

/** `0023_user_profile_and_disable.sql`, in the order it grants it. */
const MEMBER_COLUMNS = [
  'id',
  'username',
  'email',
  'created_at',
  'country_code',
  'region_code',
  'city',
  'geo_source',
  'geo_accuracy_km',
  'geo_updated_at',
  'first_name',
  'last_name',
];

describe('UsersApi', () => {
  let api: UsersApi;
  let http: HttpTestingController;

  /** The one request every test here makes against `users`. */
  const usersRequest = (request: { url: string }): boolean => request.url === '/rest/users';

  function columnsOf(request: { request: { params: { get(name: string): string | null } } }): string[] {
    return (request.request.params.get('select') ?? '').split(',');
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(UsersApi);
    http = TestBed.inject(HttpTestingController);
  });

  /*
   * `ignoreCancelled` because `forkJoin` unsubscribes from its sibling the moment one
   * branch errors, and the testing backend still counts the cancelled HTTP request as
   * outstanding. It was genuinely sent — the assertion that matters is that the 403
   * reached the caller, which the test below checks.
   */
  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('reads the users table through the same-origin PostgREST path', () => {
    api.users('member').subscribe();

    const request = http.expectOne(usersRequest);

    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('order')).toBe('created_at');
    request.flush([]);
  });

  /**
   * The load-bearing assertion of this file. A column the role cannot read fails the
   * WHOLE request with 403, so the member list names exactly the twelve columns in
   * the grant — and no admin-only column appears in it by accident.
   */
  it('names exactly the twelve columns a member is granted', () => {
    api.users('member').subscribe();

    const columns = columnsOf(http.expectOne(usersRequest));

    expect(columns).toEqual(MEMBER_COLUMNS);
    expect(columns).not.toContain('last_login_at');
    expect(columns).not.toContain('email_verified_at');
    expect(columns).not.toContain('deleted_at');
    expect(columns).not.toContain('disabled_at');
  });

  it('names every other column of the table for an administrator, and stops there', () => {
    api.users('admin').subscribe();

    const columns = columnsOf(http.expectOne(usersRequest));

    expect(columns).toEqual(ADMIN_COLUMNS);
    expect(columns).toHaveLength(22);
  });

  it('never asks for password_hash on either scope', () => {
    api.users('member').subscribe();
    expect(columnsOf(http.expectOne(usersRequest))).not.toContain('password_hash');
    http.verify();

    api.users('admin').subscribe();
    expect(columnsOf(http.expectOne(usersRequest))).not.toContain('password_hash');
  });

  /**
   * A `403` is the correct answer about a healthy session — an `app_member` reading
   * `user_roles` gets exactly that — so it must reach the caller rather than being
   * turned into an empty result, which would render as "this user holds no roles".
   */
  it('surfaces a 403 instead of resolving to an empty list', () => {
    let seen: unknown = null;
    api.users('member').subscribe({ error: (error: unknown) => (seen = error) });

    http.expectOne(usersRequest).flush('permission denied', { status: 403, statusText: 'Forbidden' });

    expect(seen).toBeInstanceOf(HttpErrorResponse);
    expect((seen as HttpErrorResponse).status).toBe(403);
  });

  it('surfaces a 401 and a 422 rather than swallowing either', () => {
    const statuses: number[] = [];
    const record = (error: unknown): void => {
      statuses.push((error as HttpErrorResponse).status);
    };

    api.users('admin').subscribe({ error: record });
    http.expectOne(usersRequest).flush('expired', { status: 401, statusText: 'Unauthorized' });
    // A second, separate read: the first errored, so this one is a new subscription.
    api.users('admin').subscribe({ error: record });
    http.expectOne(usersRequest).flush('bad column', { status: 422, statusText: 'Unprocessable' });

    expect(statuses).toEqual([401, 422]);
  });

  it('resolves group names per user, and drops a membership whose group is not readable', () => {
    const names = new Map<string, GroupNamesByUserId>();
    api.groupNamesByUserId().subscribe((resolved) => names.set('r', resolved));

    http.expectOne((request) => request.url === '/rest/user_groups').flush([
      { user_id: 'u1', group_id: 'g1' },
      { user_id: 'u1', group_id: 'g-hidden' },
      { user_id: 'u2', group_id: 'g1' },
    ]);
    http.expectOne((request) => request.url === '/rest/groups').flush([
      { id: 'g1', name: 'Engineering' },
    ]);

    // `g-hidden` is a membership the caller cannot resolve, not a group with an
    // empty name: contributing nothing is the honest rendering of "not readable".
    expect(names.get('r')?.get('u1')).toEqual(['Engineering']);
    expect(names.get('r')?.get('u2')).toEqual(['Engineering']);
  });

  it('reads role assignments, which a member will be refused', () => {
    const names = new Map<string, RoleNamesByUserId>();
    api.roleNamesByUserId().subscribe((resolved) => names.set('r', resolved));

    http.expectOne((request) => request.url === '/rest/user_roles').flush([
      { user_id: 'u1', role_id: 'role1' },
    ]);
    http.expectOne((request) => request.url === '/rest/roles').flush([
      { id: 'role1', name: 'administrator' },
    ]);

    expect(names.get('r')?.get('u1')).toEqual(['administrator']);
  });

  /**
   * A `403` on one of the two reads is the whole answer, and it is the answer the
   * caller needs: `forkJoin` cancels its sibling, so there is nothing to resolve and
   * nothing that could be mistaken for "this user holds no roles".
   */
  it('reports a 403 on the role assignments as the whole answer', () => {
    let seen: unknown = null;
    let resolved = false;
    api.roleNamesByUserId().subscribe({
      next: () => (resolved = true),
      error: (error: unknown) => (seen = error),
    });

    http.expectOne((request) => request.url === '/rest/user_roles').flush('denied', {
      status: 403,
      statusText: 'Forbidden',
    });

    expect((seen as HttpErrorResponse).status).toBe(403);
    expect(resolved).toBe(false);
  });
});

describe('columnScopeFor', () => {
  it('gives an administrator the wide column set', () => {
    expect(columnScopeFor('app_admin')).toBe('admin');
  });

  /**
   * Every other answer — a member, an unauthenticated role, a role this build has
   * never heard of, and the `null` that precedes `/auth/me` — gets the twelve
   * columns every serving role holds. Guessing wide would be a 403; guessing narrow
   * is always legal.
   */
  it('defaults to the narrowest set for anything it does not recognise', () => {
    expect(columnScopeFor('app_member')).toBe('member');
    expect(columnScopeFor('app_anon')).toBe('member');
    expect(columnScopeFor('app_admin_readonly')).toBe('member');
    expect(columnScopeFor(null)).toBe('member');
  });
});

/**
 * A `users` row the way the admin column set returns it — every displayable column
 * present.
 */
const FULL_ADMIN_ROW: UsersRow = {
  id: '0198c000-0000-7000-8000-000000000001',
  username: 'ada',
  email: 'ada@example.org',
  created_at: '2026-01-05T09:00:00.000Z',
  deleted_at: undefined,
  deletion_reason: undefined,
  email_anonymized: undefined,
  country_code: 'DE',
  region_code: 'BE',
  city: 'Berlin',
  geo_source: 'geoip',
  geo_accuracy_km: 12,
  geo_updated_at: '2026-01-06T09:00:00.000Z',
  last_activity_at: '2026-02-03T19:12:00.000Z',
  email_verified_at: '2026-01-06T09:00:00.000Z',
  first_name: 'Ada',
  last_name: 'Lovelace',
  last_login_at: '2026-02-01T08:30:00.000Z',
  disabled_at: undefined,
  disabled_by: undefined,
  disabled_reason: undefined,
  disabled_until: undefined,
};

/**
 * A COMPILE-TIME fact, asserted as a value so that removing the exclusion from
 * `UsersRow` fails this file's build rather than quietly widening what the page can
 * hold. `password_hash` is a credential artifact: it is in no column list, in no
 * `SELECT`, and in no response interface — and this is the line that makes the last
 * of those a type error instead of a review question.
 */
const ROW_TYPE_HAS_NO_PASSWORD_COLUMN: 'password_hash' extends keyof UsersRow ? false : true = true;

describe('the row type', () => {
  it('has no key named after a password, by construction', () => {
    expect(ROW_TYPE_HAS_NO_PASSWORD_COLUMN).toBe(true);
  });

  it('carries every displayable column of an administrator read', () => {
    expect(FULL_ADMIN_ROW.username).toBe('ada');
    expect(FULL_ADMIN_ROW.last_login_at).toBe('2026-02-01T08:30:00.000Z');
    expect(FULL_ADMIN_ROW.disabled_until).toBeUndefined();
  });

  it('accepts a response to the member column set, which has none of the admin keys', () => {
    const memberResponse: UsersRow = {
      id: FULL_ADMIN_ROW.id,
      username: FULL_ADMIN_ROW.username,
      email: FULL_ADMIN_ROW.email,
      created_at: FULL_ADMIN_ROW.created_at,
      country_code: FULL_ADMIN_ROW.country_code,
      region_code: FULL_ADMIN_ROW.region_code,
      city: FULL_ADMIN_ROW.city,
      geo_source: FULL_ADMIN_ROW.geo_source,
      geo_accuracy_km: FULL_ADMIN_ROW.geo_accuracy_km,
      geo_updated_at: FULL_ADMIN_ROW.geo_updated_at,
      first_name: FULL_ADMIN_ROW.first_name,
      last_name: FULL_ADMIN_ROW.last_name,
    };

    expect(Object.keys(memberResponse)).not.toContain('last_login_at');
    expect(Object.keys(memberResponse)).not.toContain('password_hash');
  });
});