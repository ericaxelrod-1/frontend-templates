import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, type Observable } from 'rxjs';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { DetectedPatternWithAttempts } from '../security-telemetry.types';
import { PatternDetectionPage } from './pattern-detection-page';

class SecurityTelemetryApiStub {
  readonly includeMockCalls: boolean[] = [];
  readonly patterns$ = new Subject<readonly DetectedPatternWithAttempts[]>();

  detectedPatterns(includeMock = false): Observable<readonly DetectedPatternWithAttempts[]> {
    this.includeMockCalls.push(includeMock);
    return this.patterns$.asObservable();
  }
}

describe('PatternDetectionPage', () => {
  let fixture: ComponentFixture<PatternDetectionPage>;
  let api: SecurityTelemetryApiStub;

  beforeEach(async () => {
    api = new SecurityTelemetryApiStub();
    await TestBed.configureTestingModule({
      imports: [PatternDetectionPage],
      providers: [{ provide: SecurityTelemetryApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(PatternDetectionPage);
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(rows: readonly DetectedPatternWithAttempts[]): Promise<void> {
    api.patterns$.next(rows);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  it('renders pattern_type, severity, status, window, attempt_count, unique_email_count, readable evidence, and linked attempts', async () => {
    await settle([
      {
        id: '0195f0e2-0001-7000-8000-000000000001',
        pattern_type: 'credential_stuffing',
        severity: 'high',
        status: 'active',
        ip: '::ffff:198.51.100.44',
        ip_normalized: '198.51.100.44',
        ip_subnet: '198.51.100.44',
        detection_timestamp: '2026-03-15T14:15:00.000Z',
        time_window_start: '2026-03-15T14:00:00.000Z',
        time_window_end: '2026-03-15T14:15:00.000Z',
        attempt_count: 18,
        unique_email_count: 14,
        evidence: {
          target_accounts: ['finance.ops', 'payroll.admin'],
          median_interval_ms: 420,
          user_agent_family: 'python-httpx/0.27',
        },
        metadata: undefined,
        is_mock: true,
        resolved_at: undefined,
        resolved_by: undefined,
        resolution_notes: undefined,
        created_at: '2026-03-15T14:15:00.000Z',
        updated_at: '2026-03-15T14:15:00.000Z',
        linkedAttempts: [
          {
            id: 'att-9001',
            username: 'finance.ops',
            ip: '::ffff:198.51.100.44',
            status: 'failed',
            created_at: '2026-03-15T14:10:05.000Z',
            ip_normalized: '198.51.100.44',
            ip_subnet: '198.51.100.44',
            attempt_kind: 'login',
            is_mock: true,
          },
        ],
      },
    ]);

    expect(text()).toContain('credential_stuffing');
    expect(text()).toContain('High');
    expect(text()).toContain('Active');
    expect(text()).toContain('18');
    expect(text()).toContain('14');
    expect(text()).toContain('median interval ms');
    expect(text()).toContain('420');
    expect(text()).toContain('target accounts');
    expect(text()).toContain('finance.ops, payroll.admin');
    expect(text()).not.toContain('{"target_accounts"');
    expect(text()).toContain('Correlated login attempts (1)');
  });
});
