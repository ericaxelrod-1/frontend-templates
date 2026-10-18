import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, type Observable } from 'rxjs';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { SecurityAlertRow } from '../security-telemetry.types';
import { SecurityAlertsPage } from './security-alerts-page';

class SecurityTelemetryApiStub {
  readonly includeMockCalls: boolean[] = [];
  readonly alerts$ = new Subject<readonly SecurityAlertRow[]>();

  securityAlerts(includeMock = false): Observable<readonly SecurityAlertRow[]> {
    this.includeMockCalls.push(includeMock);
    return this.alerts$.asObservable();
  }
}

function makeAlert(overrides: Partial<SecurityAlertRow> = {}): SecurityAlertRow {
  return {
    id: '0195f0e5-0001-7000-8000-000000000001',
    alert_type: 'brute_force',
    severity: 'critical',
    status: 'active',
    title: 'Sustained credential stuffing from 198.51.100.44',
    message: 'Rapid authentication failures across accounts.',
    source: 'system',
    pattern_id: undefined,
    ip: '::ffff:198.51.100.44',
    ip_normalized: '198.51.100.44',
    ip_subnet: '198.51.100.44',
    user_id: undefined,
    alert_data: { failed_attempts: 18, window_minutes: 15 },
    expires_at: undefined,
    is_mock: false,
    acknowledged_at: undefined,
    acknowledged_by: undefined,
    resolved_at: undefined,
    resolved_by: undefined,
    resolution_notes: undefined,
    created_at: '2026-03-15T14:15:05.000Z',
    updated_at: '2026-03-15T14:15:05.000Z',
    ...overrides,
  };
}

describe('SecurityAlertsPage', () => {
  let fixture: ComponentFixture<SecurityAlertsPage>;
  let api: SecurityTelemetryApiStub;

  beforeEach(async () => {
    api = new SecurityTelemetryApiStub();
    await TestBed.configureTestingModule({
      imports: [SecurityAlertsPage],
      providers: [{ provide: SecurityTelemetryApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(SecurityAlertsPage);
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(rows: readonly SecurityAlertRow[]): Promise<void> {
    api.alerts$.next(rows);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  it('requests non-mock alerts by default and toggles the including test rows chip when enabled', async () => {
    await settle([]);
    expect(api.includeMockCalls).toEqual([false]);
    expect(text()).not.toContain('including test rows');

    const toggleButton = (fixture.nativeElement as HTMLElement).querySelector(
      '.mock-bar button',
    ) as HTMLButtonElement;
    toggleButton.click();
    fixture.detectChanges();
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();

    expect(api.includeMockCalls).toEqual([false, true]);
    expect(text()).toContain('including test rows');
  });

  it('highlights active high/critical alerts and renders acknowledged_at, resolved_at, and resolution_notes', async () => {
    await settle([
      makeAlert(),
      makeAlert({
        id: '0195f0e5-0001-7000-8000-000000000002',
        alert_type: 'ip_block',
        severity: 'medium',
        status: 'resolved',
        title: 'Temporary reputation block applied to 198.51.100.44',
        acknowledged_at: '2026-03-15T14:18:00.000Z',
        resolved_at: '2026-03-15T15:05:00.000Z',
        resolution_notes: 'Upstream transit block confirmed; host remains quarantined.',
        is_mock: true,
      }),
    ]);

    const urgentCards = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.alert-card--urgent',
    );
    expect(urgentCards).toHaveLength(1);
    expect(text()).toContain('Unacknowledged critical');
    expect(text()).toContain('Upstream transit block confirmed; host remains quarantined.');
    expect(text()).toContain('failed attempts: 18');
    expect(text()).toContain('synthetic test row');
  });
});
