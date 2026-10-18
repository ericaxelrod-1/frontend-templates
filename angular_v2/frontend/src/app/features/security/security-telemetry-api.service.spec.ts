import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SecurityTelemetryApi } from './security-telemetry-api.service';
import type {
  DetectedPatternWithAttempts,
  LoginAttemptWithMock,
} from './security-telemetry.types';

describe('SecurityTelemetryApi', () => {
  let api: SecurityTelemetryApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(SecurityTelemetryApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('excludes synthetic rows by default on security_alerts and omits the filter when includeMock is true', () => {
    api.securityAlerts(false).subscribe();
    const defaultReq = http.expectOne((r) => r.url === '/rest/security_alerts');
    expect(defaultReq.request.params.get('is_mock')).toBe('eq.false');
    defaultReq.flush([]);

    api.securityAlerts(true).subscribe();
    const includeReq = http.expectOne((r) => r.url === '/rest/security_alerts');
    expect(includeReq.request.params.get('is_mock')).toBeNull();
    includeReq.flush([]);
  });

  it('excludes synthetic rows by default on ip_reputation and omits the filter when includeMock is true', () => {
    api.ipReputation(false).subscribe();
    const defaultReq = http.expectOne((r) => r.url === '/rest/ip_reputation');
    expect(defaultReq.request.params.get('is_mock')).toBe('eq.false');
    defaultReq.flush([]);

    api.ipReputation(true).subscribe();
    const includeReq = http.expectOne((r) => r.url === '/rest/ip_reputation');
    expect(includeReq.request.params.get('is_mock')).toBeNull();
    includeReq.flush([]);
  });

  it('joins security_detected_patterns with pattern_login_attempts and login_attempts', () => {
    let result: readonly DetectedPatternWithAttempts[] = [];
    api.detectedPatterns(true).subscribe((rows) => (result = rows));

    http.expectOne((r) => r.url === '/rest/security_detected_patterns').flush([
      {
        id: 'pat-1',
        pattern_type: 'credential_stuffing',
        severity: 'critical',
        ip: '::ffff:198.51.100.44',
        ip_normalized: '198.51.100.44',
        ip_subnet: '198.51.100.44',
        detection_timestamp: '2026-04-10T11:45:00.000Z',
        time_window_start: '2026-04-10T11:30:00.000Z',
        time_window_end: '2026-04-10T11:45:00.000Z',
        attempt_count: 2,
        unique_email_count: 2,
        evidence: { window_seconds: 900 },
        status: 'active',
        resolved_at: undefined,
        resolved_by: undefined,
        resolution_notes: undefined,
        metadata: undefined,
        is_mock: true,
        created_at: '2026-04-10T11:45:00.000Z',
        updated_at: '2026-04-10T11:45:00.000Z',
      },
    ]);
    http.expectOne((r) => r.url === '/rest/pattern_login_attempts').flush([
      {
        id: 'link-1',
        pattern_id: 'pat-1',
        login_attempt_id: 'att-101',
        is_primary_evidence: true,
        is_mock: true,
        created_at: '2026-04-10T11:45:00.000Z',
      },
    ]);
    http.expectOne((r) => r.url === '/rest/login_attempts').flush([
      {
        id: 'att-101',
        username: 'finance.ops',
        ip: '::ffff:198.51.100.44',
        status: 'failed',
        created_at: '2026-04-10T11:40:00.000Z',
        ip_normalized: '198.51.100.44',
        ip_subnet: '198.51.100.44',
        attempt_kind: 'login',
        // The attempt carries its OWN flag since `0025`. It used to take the
        // link's flag, which made an attempt's synthetic-ness a property of how
        // the rows happened to be linked rather than of the attempt.
        is_mock: true,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.linkedAttempts).toHaveLength(1);
    expect(result[0]?.linkedAttempts[0]?.username).toBe('finance.ops');
    expect(result[0]?.linkedAttempts[0]?.is_mock).toBe(true);
  });

  it('asks the DATABASE for real attempts only, and asks for no second table', () => {
    // The filter is a PREDICATE ON THE REQUEST, not a filter in this process.
    //
    // It used to be derived: the page fetched every attempt and every synthetic
    // pattern link, and treated an attempt as synthetic if a link referenced it.
    // That made an attempt's synthetic-ness a property of how the rows happened
    // to be linked rather than of the attempt — a synthetic attempt linked to no
    // pattern was indistinguishable from a real one — and it put "synthetic rows
    // are hidden by default" in JavaScript, so a direct request to
    // `/rest/login_attempts` returned them whatever this page did.
    //
    // `0025` gave `login_attempts` an `is_mock` column, so the question is now
    // asked of the database in one request, exactly as the other four telemetry
    // tables are asked.
    let defaultRows: readonly LoginAttemptWithMock[] = [];
    api.loginAttempts(false).subscribe((rows) => (defaultRows = rows));

    const request = http.expectOne((r) => r.url === '/rest/login_attempts');
    expect(request.request.params.get('is_mock')).toBe('eq.false');
    expect(request.request.params.get('select')).toContain('is_mock');
    request.flush([
      {
        id: 'att-real-1',
        username: 'real-user',
        ip: '127.0.0.1',
        status: 'succeeded',
        created_at: '2026-04-10T12:00:00.000Z',
        ip_normalized: '127.0.0.1',
        ip_subnet: '127.0.0.1',
        attempt_kind: 'login',
        is_mock: false,
      },
    ]);

    // ONE request. The old implementation issued two — the second being the
    // `pattern_login_attempts` read the derivation depended on.
    http.expectNone((r) => r.url === '/rest/pattern_login_attempts');
    expect(defaultRows.map((r) => r.id)).toEqual(['att-real-1']);
  });

  it('asks for every attempt when the test rows are included', () => {
    let allRows: readonly LoginAttemptWithMock[] = [];
    api.loginAttempts(true).subscribe((rows) => (allRows = rows));

    const request = http.expectOne((r) => r.url === '/rest/login_attempts');
    // No predicate at all: the database is not asked to hide anything, so the
    // synthetic rows come back and the page can badge them.
    expect(request.request.params.get('is_mock')).toBeNull();
    request.flush([
      {
        id: 'att-mock-1',
        username: 'finance.ops',
        ip: '198.51.100.44',
        status: 'failed',
        created_at: '2026-04-10T11:40:00.000Z',
        ip_normalized: '198.51.100.44',
        ip_subnet: '198.51.100.44',
        attempt_kind: 'login',
        is_mock: true,
      },
    ]);

    expect(allRows.map((r) => r.is_mock)).toEqual([true]);
  });

  it('surfaces a 403 error from PostgREST untouched', () => {
    let seen: unknown = null;
    api.securityAlerts(false).subscribe({ error: (err: unknown) => (seen = err) });

    http
      .expectOne((r) => r.url === '/rest/security_alerts')
      .flush('permission denied', { status: 403, statusText: 'Forbidden' });

    expect(seen).toBeInstanceOf(HttpErrorResponse);
    expect((seen as HttpErrorResponse).status).toBe(403);
  });
});
