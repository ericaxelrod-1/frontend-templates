import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Subject, type Observable } from 'rxjs';
import { NotificationApi } from '../notification-api.service';
import type { AdminNotificationRow } from '../notification.types';
import { NotificationsPage } from './notifications-page';

class NotificationApiStub {
  readonly includeMockCalls: boolean[] = [];
  readonly rows$ = new Subject<readonly AdminNotificationRow[]>();

  notifications(includeMock = false): Observable<readonly AdminNotificationRow[]> {
    this.includeMockCalls.push(includeMock);
    return this.rows$.asObservable();
  }
}

function makeNotification(overrides: Partial<AdminNotificationRow> = {}): AdminNotificationRow {
  return {
    id: '0195f0e5-0003-7000-8000-000000000001',
    source: 'security_alerts',
    kind: 'brute_force',
    severity: 'critical',
    title: 'Sustained credential stuffing from 198.51.100.44',
    message: 'Rapid authentication failures across accounts.',
    data: { ip_normalized: '198.51.100.44', alert_data: { failed_attempts: 18, window_minutes: 15 } },
    source_ref: '0195f0e5-0003-7000-8000-0000000000a1',
    audience: 'administrators',
    is_mock: false,
    created_at: '2026-03-15T14:15:05.000Z',
    updated_at: '2026-03-15T14:15:05.000Z',
    expires_at: '2026-04-14T14:15:05.000Z',
    ...overrides,
  };
}

describe('NotificationsPage', () => {
  let fixture: ComponentFixture<NotificationsPage>;
  let api: NotificationApiStub;

  beforeEach(async () => {
    api = new NotificationApiStub();
    await TestBed.configureTestingModule({
      imports: [NotificationsPage],
      providers: [{ provide: NotificationApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(NotificationsPage);
    fixture.detectChanges();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(rows: readonly AdminNotificationRow[]): Promise<void> {
    api.rows$.next(rows);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  function select(label: string): HTMLSelectElement {
    const field = [...host().querySelectorAll('label')].find((element) =>
      element.textContent?.trim().startsWith(label),
    );
    const control = field?.querySelector('select');
    if (control === null || control === undefined) {
      throw new Error(`no filter named ${label}`);
    }
    return control;
  }

  it('requests non-mock notifications by default and toggles the including test rows chip when enabled', async () => {
    await settle([]);
    expect(api.includeMockCalls).toEqual([false]);
    expect(text()).not.toContain('including test rows');

    const toggleButton = host().querySelector('.mock-bar button') as HTMLButtonElement;
    toggleButton.click();
    fixture.detectChanges();
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();

    expect(api.includeMockCalls).toEqual([false, true]);
    expect(text()).toContain('including test rows');
  });

  it('highlights active high/critical notifications and renders the acknowledge, resolve and dismissal state', async () => {
    await settle([
      makeNotification(),
      makeNotification({
        id: '0195f0e5-0003-7000-8000-000000000002',
        kind: 'ip_block',
        severity: 'medium',
        title: 'Temporary reputation block applied to 198.51.100.44',
        acknowledged_at: '2026-03-15T14:18:00.000Z',
        resolved_at: '2026-03-15T15:05:00.000Z',
        resolution_notes: 'Upstream transit block confirmed; host remains quarantined.',
        dismissed_at: '2026-03-15T15:06:00.000Z',
        is_mock: true,
      }),
    ]);

    expect(host().querySelectorAll('.alert-card--urgent')).toHaveLength(1);
    expect(text()).toContain('Unacknowledged critical');
    expect(text()).toContain('Upstream transit block confirmed; host remains quarantined.');
    expect(text()).toContain('failed attempts: 18');
    expect(text()).toContain('synthetic test row');

    // The derived status, scoped to the second card so the filter dropdown's option list
    // cannot satisfy it. Precedence is the stored column's: dismissed wins over resolved,
    // which wins over acknowledged — a dismissed notification is not also "active".
    const dismissed = host().querySelectorAll('.alert-card')[1] as HTMLElement;
    const badges = [...dismissed.querySelectorAll('.badge')].map((badge) => badge.textContent?.trim());
    expect(badges).toContain('Dismissed');
    expect(badges).not.toContain('Active (unacknowledged)');
    expect(badges).not.toContain('Resolved');
    expect(badges).not.toContain('Acknowledged');

    const active = host().querySelectorAll('.alert-card')[0] as HTMLElement;
    expect([...active.querySelectorAll('.badge')].map((badge) => badge.textContent?.trim())).toContain(
      'Active (unacknowledged)',
    );
  });

  it('keeps every filter the previous page had: status, severity and the dynamic type list', async () => {
    await settle([makeNotification(), makeNotification({ id: '0195f0e5-0003-7000-8000-000000000003', kind: 'ip_block', severity: 'low' })]);

    const statusOptions = [...select('Status').options].map((option) => option.value);
    expect(statusOptions).toEqual(['all', 'active', 'acknowledged', 'resolved', 'dismissed']);

    const severityOptions = [...select('Severity').options].map((option) => option.value);
    expect(severityOptions).toEqual(['all', 'critical', 'high', 'medium', 'low']);

    const kindOptions = [...select('Notification type').options].map((option) => option.value);
    expect(kindOptions).toEqual(['all', 'brute_force', 'ip_block']);

    // …and each one still filters.
    select('Severity').value = 'low';
    select('Severity').dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(host().querySelectorAll('.alert-card')).toHaveLength(1);

    select('Severity').value = 'all';
    select('Severity').dispatchEvent(new Event('change'));
    select('Status').value = 'dismissed';
    select('Status').dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(host().querySelectorAll('.alert-card')).toHaveLength(0);
  });

  it('renders the canonical IP out of `data`, and says "not recorded" when the source carries none', async () => {
    await settle([makeNotification(), makeNotification({ id: '0195f0e5-0003-7000-8000-000000000004', data: {} })]);
    expect(text()).toContain('198.51.100.44');
    expect(text()).toContain('not recorded');
  });

  it('names the materialiser when the panel is empty, so an empty list is diagnosable', async () => {
    await settle([]);
    // The alternative — a bare "no results" — is the shape a broken materialiser and a
    // quiet system are indistinguishable by, and §2.3 is about that difference.
    expect(text()).toContain('notifications.materialize');
  });
});