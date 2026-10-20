import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { lastValueFrom } from 'rxjs';
import { PrivacyApi } from './privacy-api.service';
import type { EraseResponse } from './privacy.types';

describe('PrivacyApi', () => {
  let api: PrivacyApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PrivacyApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts erasure to /api/privacy/erase with no subject in body or query', async () => {
    const outcome: EraseResponse = {
      userId: '0192e210-aaaa-7000-8000-000000000001',
      alreadyErased: false,
      tombstoneAddress: 'deleted-1234abcd@example.com',
      anonymizedAt: '2026-10-19T22:00:00.000Z',
      pepperKid: 'v1',
    };

    const call = lastValueFrom(api.eraseSelf());
    const req = http.expectOne('/api/privacy/erase');

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(outcome);

    await expect(call).resolves.toEqual(outcome);
  });

  it('reads current privacy profile via /api/users/me', async () => {
    const meRow = {
      id: '0192e210-aaaa-7000-8000-000000000001',
      username: 'ada',
      email: 'ada@example.org',
      created_at: '2026-01-01T00:00:00.000Z',
    };

    const call = lastValueFrom(api.myPrivacyState());
    const req = http.expectOne('/api/users/me');

    expect(req.request.method).toBe('GET');
    req.flush(meRow);

    await expect(call).resolves.toEqual(meRow);
  });

  it('reads purge queue from PostgREST', async () => {
    const queue = [
      { id: 'q1', status: 'pending', scheduled_for: '2026-11-01T00:00:00Z', completed_at: null },
    ];

    const call = lastValueFrom(api.purgeQueue());
    const req = http.expectOne((r) => r.url.startsWith('/rest/privacy_purge_queue'));

    expect(req.request.method).toBe('GET');
    req.flush(queue);

    await expect(call).resolves.toEqual(queue);
  });
});
