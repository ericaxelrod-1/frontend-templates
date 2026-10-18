import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable} from 'rxjs';
import { Subject } from 'rxjs';
import type { ProfileLoginAttempt } from './login-attempt';
import { ProfileLoginHistory } from './login-history';
import { ProfileApi } from './profile-api.service';

const ATTEMPTS: readonly ProfileLoginAttempt[] = [
  {
    id: 'a1',
    ip: '198.51.100.7',
    status: 'failed',
    attempt_kind: 'login',
    created_at: '2026-02-01T08:30:00.000Z',
    ip_subnet: '198.51.100.0/24',
  },
  {
    id: 'a2',
    ip: '203.0.113.9',
    status: 'succeeded',
    attempt_kind: 'token_request',
    created_at: '2026-02-01T08:31:00.000Z',
    ip_subnet: '203.0.113.0/24',
  },
];

class ProfileApiStub {
  readonly responses = new Subject<readonly ProfileLoginAttempt[]>();

  loginAttempts(): Observable<readonly ProfileLoginAttempt[]> {
    return this.responses.asObservable();
  }
}

describe('ProfileLoginHistory', () => {
  let fixture: ComponentFixture<ProfileLoginHistory>;
  let api: ProfileApiStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(attempts: readonly ProfileLoginAttempt[]): Promise<void> {
    api.responses.next(attempts);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    api = new ProfileApiStub();
    await TestBed.configureTestingModule({
      imports: [ProfileLoginHistory],
      providers: [{ provide: ProfileApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfileLoginHistory);
    fixture.detectChanges();
  });

  /**
   * The reason the caption exists. `login_attempts` has no `user_id` — it is
   * deliberately text so an attempt against a username that does not exist is still
   * recorded — and a table with no comment about that reads as a missing foreign
   * key.
   */
  it('explains that the history is matched by username, and why there is no user id', async () => {
    await settle([]);

    const caption = text();
    expect(caption).toContain('has no user id');
    expect(caption).toContain('deliberately text');
    expect(caption).toContain('username is immutable');
  });

  it('renders a row per attempt, with the outcome and the kind named', async () => {
    await settle(ATTEMPTS);

    const rows = Array.from(element().querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    const first = rows[0]?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(first).toContain('sign-in');
    expect(first).toContain('failed');
    // Both addresses: the observed one and the aggregate the counters key on, so a
    // member can tell one machine from a crowd behind one address.
    expect(first).toContain('198.51.100.7');
    expect(first).toContain('198.51.100.0/24');
  });

  it('names the two attempt kinds apart, since they are separate populations', async () => {
    await settle(ATTEMPTS);

    expect(text()).toContain('sign-in');
    expect(text()).toContain('access token request');
  });

  it('says an absent address is unrecorded rather than rendering a blank', async () => {
    await settle([{ id: 'a3', status: 'failed', attempt_kind: 'login', created_at: '2026-02-02T00:00:00.000Z' }]);

    expect(element().querySelectorAll('tbody tr')[0]?.textContent).toContain('not recorded');
  });

  it('shows a code outside the vocabulary rather than an empty outcome', async () => {
    await settle([
      { id: 'a4', status: 'challenged', attempt_kind: 'login', created_at: '2026-02-02T00:00:00.000Z' },
    ]);

    expect(text()).toContain('unrecognised code "challenged"');
  });

  it('reports a refused read rather than showing an empty history', async () => {
    api.responses.error(new HttpErrorResponse({ status: 403 }));
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('may not read its own sign-in history');
  });

  it('says so when the database returned no attempts', async () => {
    await settle([]);

    expect(text()).toContain('No attempt rows were returned for your username.');
  });
});