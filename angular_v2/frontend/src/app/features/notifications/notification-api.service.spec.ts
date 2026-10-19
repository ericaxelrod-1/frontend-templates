import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import { NotificationApi } from './notification-api.service';

/**
 * The read, asserted as the REQUEST it makes.
 *
 * `AGENTS.md` §F4: HTTP lives in services only, so a service spec is where the URL,
 * the column list and the filters are pinned. The expiry filter is the one that matters
 * — it is the requirement that a five-year-old notification never surfaces, and it
 * belongs in the QUERY rather than in a template `if` a caller can ask a different
 * question of.
 */
describe('NotificationApi', () => {
  let api: NotificationApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(NotificationApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('reads admin_notifications — not the source table — with the live-row and expiry filters', () => {
    api.notifications().subscribe();
    const request = http.expectOne((candidate) => candidate.url === `${POSTGREST_BASE_URL}/admin_notifications`);

    expect(request.request.method).toBe('GET');
    const params = request.request.params;
    expect(params.get('order')).toBe('created_at.desc,id.asc');
    expect(params.get('is_mock')).toBe('eq.false');
    // `gt.<now>` — an ISO instant, which is the only form PostgREST parses for `gt` on
    // a timestamptz column.
    expect(params.get('expires_at')).toMatch(/^gt\.\d{4}-\d{2}-\d{2}T/);

    // Every column the panel renders is named explicitly: the table is not readable with
    // `select=*` for a column-restricted role, and naming them is what makes the
    // rendered set auditable against `openapi.json`.
    const selected = (params.get('select') ?? '').split(',');
    expect(selected).toEqual(
      expect.arrayContaining([
        'id',
        'source',
        'kind',
        'severity',
        'title',
        'message',
        'data',
        'acknowledged_at',
        'resolved_at',
        'resolution_notes',
        'dismissed_at',
        'is_mock',
        'created_at',
        'expires_at',
      ]),
    );

    request.flush([]);
  });

  it('drops the is_mock filter when synthetic rows are included, and keeps the expiry one', () => {
    api.notifications(true).subscribe();
    const request = http.expectOne((candidate) => candidate.url === `${POSTGREST_BASE_URL}/admin_notifications`);
    expect(request.request.params.get('is_mock')).toBeNull();
    expect(request.request.params.get('expires_at')).toMatch(/^gt\./);
    request.flush([]);
  });
});