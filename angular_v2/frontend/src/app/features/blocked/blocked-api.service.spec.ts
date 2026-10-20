import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { lastValueFrom } from 'rxjs';
import { BlockedApi } from './blocked-api.service';
import type { DisabledUserRow } from './blocked.types';

describe('BlockedApi', () => {
  let api: BlockedApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(BlockedApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('queries PostgREST for users with disabled_at not null', async () => {
    const rows: DisabledUserRow[] = [
      {
        id: 'u-1',
        username: 'bob',
        email: 'bob@example.com',
        created_at: '2026-01-01T00:00:00Z',
        first_name: 'Bob',
        last_name: 'Builder',
        disabled_at: '2026-05-01T00:00:00Z',
        disabled_by: 'admin-uuid',
        disabled_reason: 'admin',
        disabled_until: null,
      },
    ];

    const call = lastValueFrom(api.blockedUsers());
    const req = http.expectOne((r) => r.url === '/rest/users');

    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('disabled_at')).toBe('not.is.null');
    expect(req.request.params.get('order')).toBe('disabled_at.desc');
    req.flush(rows);

    await expect(call).resolves.toEqual(rows);
  });

  it('sends PATCH to clear disable fields when re-enabling an account', async () => {
    const call = lastValueFrom(api.reEnable('u-1'));
    const req = http.expectOne((r) => r.url === '/rest/users');

    expect(req.request.method).toBe('PATCH');
    expect(req.request.params.get('id')).toBe('eq.u-1');
    expect(req.request.body).toEqual({
      disabled_at: null,
      disabled_by: null,
      disabled_reason: null,
      disabled_until: null,
    });
    req.flush(null);

    await expect(call).resolves.toBeNull();
  });
});
