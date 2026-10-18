import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, type Observable } from 'rxjs';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { LoginAttemptWithMock } from '../security-telemetry.types';
import { LoginAttemptsPage } from './login-attempts-page';

class SecurityTelemetryApiStub {
  readonly includeMockCalls: boolean[] = [];
  readonly attempts$ = new Subject<readonly LoginAttemptWithMock[]>();

  loginAttempts(includeMock = false): Observable<readonly LoginAttemptWithMock[]> {
    this.includeMockCalls.push(includeMock);
    return this.attempts$.asObservable();
  }
}

describe('LoginAttemptsPage', () => {
  let fixture: ComponentFixture<LoginAttemptsPage>;
  let api: SecurityTelemetryApiStub;

  beforeEach(async () => {
    api = new SecurityTelemetryApiStub();
    await TestBed.configureTestingModule({
      imports: [LoginAttemptsPage],
      providers: [{ provide: SecurityTelemetryApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginAttemptsPage);
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(rows: readonly LoginAttemptWithMock[]): Promise<void> {
    api.attempts$.next(rows);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  it('renders the full login attempt log and filters synthetic rows by default', async () => {
    await settle([
      {
        id: '0195f0e1-0001-7000-8000-000000000001',
        username: 'finance.ops',
        ip: '::ffff:198.51.100.44',
        status: 'failed',
        created_at: '2026-03-15T14:10:05.000Z',
        ip_normalized: '198.51.100.44',
        ip_subnet: '198.51.100.44',
        attempt_kind: 'login',
        is_mock: true,
      },
    ]);

    expect(api.includeMockCalls).toEqual([false]);
    expect(text()).toContain('#0195f0e1-0001-7000-8000-000000000001');
    expect(text()).toContain('finance.ops');
    expect(text()).toContain('198.51.100.44');
    expect(text()).toContain('raw: ::ffff:198.51.100.44');
    expect(text()).toContain('Credential check (login)');
    expect(text()).toContain('Failed');
    expect(text()).toContain('synthetic test row');
  });
});
