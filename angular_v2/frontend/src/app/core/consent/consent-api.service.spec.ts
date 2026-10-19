import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { POSTGREST_BASE_URL } from '../api/api-base-urls';
import { ConsentApi } from './consent-api.service';

describe('ConsentApi', () => {
  let api: ConsentApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ConsentApi,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ConsentApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches purposes ordered by sort_order and key', () => {
    api.purposes().subscribe((res) => {
      expect(res).toHaveLength(1);
      expect(res[0]?.key).toBe('analytics');
    });

    const req = httpMock.expectOne((r) => r.url === `${POSTGREST_BASE_URL}/consent_purposes`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('order')).toBe('sort_order.asc,key.asc');
    req.flush([
      {
        id: '1',
        key: 'analytics',
        label: 'Analytics',
        description: 'Measures site usage',
        legal_basis: 'consent',
        requires_consent: true,
        policy_version: 1,
        sort_order: 1,
        created_at: '',
        updated_at: '',
      },
    ]);
  });

  it('fetches effective consent records for a user ordered newest first', () => {
    api.effectiveConsent('user-123').subscribe((records) => {
      expect(records).toHaveLength(1);
      expect(records[0]?.purpose_key).toBe('analytics');
    });

    const req = httpMock.expectOne((r) => r.url === `${POSTGREST_BASE_URL}/consent_records`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('user_id')).toBe('eq.user-123');
    expect(req.request.params.get('order')).toBe('recorded_at.desc,id.desc');
    req.flush([
      {
        id: 'rec-1',
        user_id: 'user-123',
        purpose_key: 'analytics',
        granted: true,
        policy_version: 1,
        mechanism: 'ui',
        source: 'app',
        recorded_at: '2026-10-19T00:00:00Z',
      },
    ]);
  });

  it('posts a consent decision to the record_consent_decision RPC', () => {
    api.recordConsentDecision('marketing', false, 'widget').subscribe((id) => {
      expect(id).toBe('rec-new');
    });

    const req = httpMock.expectOne(`${POSTGREST_BASE_URL}/rpc/record_consent_decision`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      p_purpose_key: 'marketing',
      p_granted: false,
      p_mechanism: 'widget',
      p_source: 'app',
    });
    req.flush('rec-new');
  });

  it('surfaces a failed write instead of resolving to a value that looks like success', () => {
    // THE DEFECT THIS UNIT FIXES. The write used to end in
    // `catchError(() => of(null))`, so a 404 from a route that did not exist
    // became `null` — indistinguishable from a successful write that returned
    // nothing — and the person who clicked "accept" was told their choice was
    // recorded when no row existed (AGENTS.md §2.3).
    const emitted: unknown[] = [];
    let failure: unknown = null;

    api.recordConsentDecision('marketing', true, 'widget').subscribe({
      next: (value: unknown) => emitted.push(value),
      error: (reason: unknown) => {
        failure = reason;
      },
    });

    const req = httpMock.expectOne(`${POSTGREST_BASE_URL}/rpc/record_consent_decision`);
    req.flush('not found', { status: 404, statusText: 'Not Found' });

    expect(failure, 'the failed write was swallowed').toBeInstanceOf(HttpErrorResponse);
    expect(emitted, 'a failed write emitted a success-shaped value').toEqual([]);
  });

  it('surfaces a failed catalogue read instead of resolving to an empty catalogue', () => {
    // The catalogue read used to end in `catchError(() => of([]))`, which
    // turned a catalogue that could not be fetched into an EMPTY catalogue —
    // indistinguishable from a deployment that has configured no purposes,
    // and the reason the consent gate's own `catch { }` was unreachable: the
    // failure never reached it (AGENTS.md §2.3).
    const emitted: unknown[] = [];
    let failure: unknown = null;

    api.purposes().subscribe({
      next: (value: unknown) => emitted.push(value),
      error: (reason: unknown) => {
        failure = reason;
      },
    });

    const req = httpMock.expectOne((r) => r.url === `${POSTGREST_BASE_URL}/consent_purposes`);
    req.flush('unavailable', { status: 503, statusText: 'Service Unavailable' });

    expect(failure, 'the failed catalogue read was swallowed').toBeInstanceOf(HttpErrorResponse);
    expect(emitted, 'a failed catalogue read emitted an empty catalogue').toEqual([]);
  });
});
