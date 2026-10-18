import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, type Observable } from 'rxjs';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { IpReputationRow } from '../security-telemetry.types';
import { IpReputationPage } from './ip-reputation-page';

class SecurityTelemetryApiStub {
  readonly includeMockCalls: boolean[] = [];
  readonly reputation$ = new Subject<readonly IpReputationRow[]>();

  ipReputation(includeMock = false): Observable<readonly IpReputationRow[]> {
    this.includeMockCalls.push(includeMock);
    return this.reputation$.asObservable();
  }
}

function makeReputationRow(overrides: Partial<IpReputationRow> = {}): IpReputationRow {
  return {
    id: '0195f0e0-0001-7000-8000-000000000001',
    ip: '::ffff:198.51.100.44',
    ip_normalized: '198.51.100.44',
    ip_subnet: '198.51.100.44',
    reputation_score: 12,
    status: 'bad',
    failed_attempts: 18,
    captcha_required_count: 4,
    is_blocked: true,
    blocked_until: '2026-10-18T06:00:00.000Z',
    geo_location: { country_code: 'DE', city: 'Frankfurt' },
    statistics: { window_minutes: 15, distinct_usernames: 14 },
    block_history: [{ reason: 'credential_stuffing' }],
    metadata: { asn: 64496, org: 'Example Transit DE' },
    is_mock: true,
    created_at: '2026-03-15T14:00:00.000Z',
    updated_at: '2026-03-15T14:15:00.000Z',
    ...overrides,
  };
}

describe('IpReputationPage', () => {
  let fixture: ComponentFixture<IpReputationPage>;
  let api: SecurityTelemetryApiStub;

  beforeEach(async () => {
    api = new SecurityTelemetryApiStub();
    await TestBed.configureTestingModule({
      imports: [IpReputationPage],
      providers: [{ provide: SecurityTelemetryApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(IpReputationPage);
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(rows: readonly IpReputationRow[]): Promise<void> {
    api.reputation$.next(rows);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  it('shows canonical ip_normalized as identity and hides raw ip when identical', async () => {
    await settle([
      makeReputationRow({
        ip: '198.51.100.44',
        ip_normalized: '198.51.100.44',
      }),
    ]);

    expect(text()).toContain('198.51.100.44');
    expect(text()).not.toContain('raw:');
  });

  it('shows raw ip when it differs from ip_normalized and renders status, score, failed_attempts, and block state', async () => {
    await settle([makeReputationRow()]);

    expect(text()).toContain('198.51.100.44');
    expect(text()).toContain('raw: ::ffff:198.51.100.44');
    expect(text()).toContain('Bad');
    expect(text()).toContain('12 / 100');
    expect(text()).toContain('18');
    expect(text()).toContain('Blocked');
    expect(text()).toContain('Example Transit DE');
  });
});
