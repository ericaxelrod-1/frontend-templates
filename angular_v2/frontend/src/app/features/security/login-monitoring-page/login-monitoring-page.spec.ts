import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, type Observable } from 'rxjs';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { LoginAttemptWithMock, SecurityAlertRow } from '../security-telemetry.types';
import { LoginMonitoringPage } from './login-monitoring-page';

class SecurityTelemetryApiStub {
  readonly attempts$ = new Subject<readonly LoginAttemptWithMock[]>();
  readonly alerts$ = new Subject<readonly SecurityAlertRow[]>();

  loginAttempts(): Observable<readonly LoginAttemptWithMock[]> {
    return this.attempts$.asObservable();
  }

  securityAlerts(): Observable<readonly SecurityAlertRow[]> {
    return this.alerts$.asObservable();
  }
}

describe('LoginMonitoringPage', () => {
  let fixture: ComponentFixture<LoginMonitoringPage>;
  let api: SecurityTelemetryApiStub;

  beforeEach(async () => {
    api = new SecurityTelemetryApiStub();
    await TestBed.configureTestingModule({
      imports: [LoginMonitoringPage],
      providers: [{ provide: SecurityTelemetryApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginMonitoringPage);
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(
    attempts: readonly LoginAttemptWithMock[],
    alerts: readonly SecurityAlertRow[],
  ): Promise<void> {
    api.attempts$.next(attempts);
    api.alerts$.next(alerts);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  it('distinguishes login and token_request budgets and correlates raised security alerts', async () => {
    await settle(
      [
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
        {
          id: 'att-9003',
          username: 'treasury.lead',
          ip: '2001:db8:42:10::a',
          status: 'failed',
          created_at: '2026-03-15T14:14:00.000Z',
          ip_normalized: '2001:db8:42:10::a',
          ip_subnet: '2001:db8:42:10::/64',
          attempt_kind: 'token_request',
          is_mock: true,
        },
      ],
      [
        {
          id: 'alert-1',
          alert_type: 'brute_force',
          severity: 'critical',
          status: 'active',
          title: 'Sustained credential stuffing from 198.51.100.44',
          message: 'Burst of failed logins.',
          source: 'system',
          pattern_id: undefined,
          ip: '::ffff:198.51.100.44',
          ip_normalized: '198.51.100.44',
          ip_subnet: '198.51.100.44',
          user_id: undefined,
          alert_data: {},
          expires_at: undefined,
          is_mock: true,
          acknowledged_at: undefined,
          acknowledged_by: undefined,
          resolved_at: undefined,
          resolved_by: undefined,
          resolution_notes: undefined,
          created_at: '2026-03-15T14:15:05.000Z',
          updated_at: '2026-03-15T14:15:05.000Z',
        },
      ],
    );

    expect(text()).toContain('Credential check (login)');
    expect(text()).toContain('Reset/verification token (token_request)');
    expect(text()).toContain('Sustained credential stuffing from 198.51.100.44');
  });
});
