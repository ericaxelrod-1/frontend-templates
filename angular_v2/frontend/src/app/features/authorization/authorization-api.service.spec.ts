import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import { AuthorizationApi } from './authorization-api.service';

/**
 * The requests the administration surface makes, asserted as the requests.
 *
 * `AGENTS.md` §F4: HTTP lives in services only, so a service spec is where the
 * URL, the column list and the body are pinned. The properties that matter here
 * are the ones a hand-written URL would get wrong: the composite-key tables are
 * addressed by BOTH columns, a mutation that changed nothing is reported as
 * nothing, and every column is named.
 */
describe('AuthorizationApi', () => {
  let api: AuthorizationApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AuthorizationApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('reads the scope axis: the hierarchy, the memberships and the people', () => {
    api.scope().subscribe();
    const requests = http.match((candidate) => candidate.url.startsWith(`${POSTGREST_BASE_URL}/`));
    const urls = requests.map((request) => request.request.url);

    expect(urls).toEqual([
      `${POSTGREST_BASE_URL}/groups`,
      `${POSTGREST_BASE_URL}/user_groups`,
      `${POSTGREST_BASE_URL}/users`,
    ]);
    for (const request of requests) {
      // Every column is named: a column-restricted role cannot use `select=*`,
      // and a list of column names is a thing a reviewer can read.
      expect(request.request.params.get('select')).toBeTruthy();
    }
    for (const request of requests) {
      request.flush([]);
    }
  });

  it('reads the capability axis, and does not read the actions table a second time', () => {
    api.capability().subscribe();
    const requests = http.match((candidate) => candidate.url.startsWith(`${POSTGREST_BASE_URL}/`));
    const urls = requests.map((request) => request.request.url);

    expect(urls).toEqual([
      `${POSTGREST_BASE_URL}/roles`,
      `${POSTGREST_BASE_URL}/user_roles`,
      `${POSTGREST_BASE_URL}/role_permissions`,
      `${POSTGREST_BASE_URL}/permissions`,
    ]);
    // `permissions.action_id` IS the action's name, so reading `actions` would be
    // a second copy of the same fact.
    expect(urls).not.toContain(`${POSTGREST_BASE_URL}/actions`);
    for (const request of requests) {
      request.flush([]);
    }
  });

  it('creates a group, and omits the parent when the group is a root', () => {
    api.createGroup('Regional', null).subscribe();
    const request = http.expectOne(`${POSTGREST_BASE_URL}/groups`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Regional' });
    request.flush(null);
  });

  it('creates a group under a parent, naming the parent', () => {
    api.createGroup('Regional', 'g-eu').subscribe();
    const request = http.expectOne(`${POSTGREST_BASE_URL}/groups`);

    expect(request.request.body).toEqual({ name: 'Regional', parent_id: 'g-eu' });
    request.flush(null);
  });

  it('moves a group by patching the parent, and asks for the affected rows back', () => {
    api.moveGroup('g-fr', 'g-eu').subscribe();
    const request = http.expectOne((candidate) => candidate.url === `${POSTGREST_BASE_URL}/groups`);

    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ parent_id: 'g-eu' });
    expect(request.request.params.get('id')).toBe('eq.g-fr');
    // `return=representation` is what makes "nothing was changed" visible.
    expect(request.request.headers.get('Prefer')).toBe('return=representation');
    request.flush([{ id: 'g-fr' }]);
  });

  it('removes a member by addressing the membership on BOTH of its key columns', () => {
    api.removeMember('u-alice', 'g-eu').subscribe();
    const request = http.expectOne((candidate) => candidate.url === `${POSTGREST_BASE_URL}/user_groups`);

    expect(request.request.method).toBe('DELETE');
    expect(request.request.params.get('user_id')).toBe('eq.u-alice');
    expect(request.request.params.get('group_id')).toBe('eq.g-eu');
    request.flush([{ user_id: 'u-alice', group_id: 'g-eu' }]);
  });

  it('adds a member with the two columns the membership is made of', () => {
    api.addMember('u-alice', 'g-eu').subscribe();
    const request = http.expectOne(`${POSTGREST_BASE_URL}/user_groups`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ user_id: 'u-alice', group_id: 'g-eu' });
    request.flush(null);
  });

  it('assigns and revokes a role, addressing the assignment on both key columns', () => {
    api.assignRole('u-alice', 'r-manager').subscribe();
    const assign = http.expectOne(`${POSTGREST_BASE_URL}/user_roles`);
    expect(assign.request.method).toBe('POST');
    expect(assign.request.body).toEqual({ user_id: 'u-alice', role_id: 'r-manager' });
    assign.flush(null);

    api.revokeRole('u-alice', 'r-manager').subscribe();
    const revoke = http.expectOne((candidate) => candidate.url === `${POSTGREST_BASE_URL}/user_roles`);
    expect(revoke.request.method).toBe('DELETE');
    expect(revoke.request.params.get('user_id')).toBe('eq.u-alice');
    expect(revoke.request.params.get('role_id')).toBe('eq.r-manager');
    revoke.flush([{ user_id: 'u-alice', role_id: 'r-manager' }]);
  });

  /**
   * A statement that matched no row exits 0 and changes nothing. Reporting that
   * as a success is a success-shaped value for work that did not happen
   * (`AGENTS.md` §2.3), so it is raised instead.
   */
  it('reports a mutation that changed no row as what it is', () => {
    let failure: unknown = null;
    api.removeMember('u-alice', 'g-eu').subscribe({ error: (error: unknown) => (failure = error) });
    const request = http.expectOne((candidate) => candidate.url === `${POSTGREST_BASE_URL}/user_groups`);

    request.flush([]);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('matched no row');
  });
});
