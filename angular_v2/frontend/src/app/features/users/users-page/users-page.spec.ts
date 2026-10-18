import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable} from 'rxjs';
import { Subject } from 'rxjs';
import { Session } from '../../../core/auth/session.service';
import {
  UsersApi,
  type GroupNamesByUserId,
  type RoleNamesByUserId,
  type UsersColumnScope,
  type UsersRow,
} from '../users-api.service';
import { UsersPage } from './users-page';

/**
 * A hand-written `UsersApi`, so these tests exercise the PAGE's decisions — which
 * columns it asked for, and how it renders a grant it does not have — without a
 * server. Permitted in `*.spec.ts` only (AGENTS.md §2.2); the request the browser
 * actually makes is asserted in `users-api.service.spec.ts` instead, against
 * `HttpTestingController`.
 */
class UsersApiStub {
  readonly scopes: UsersColumnScope[] = [];
  readonly usersResponse = new Subject<readonly UsersRow[]>();
  readonly groupsResponse = new Subject<GroupNamesByUserId>();
  readonly rolesResponse = new Subject<RoleNamesByUserId>();

  users(scope: UsersColumnScope): Observable<readonly UsersRow[]> {
    this.scopes.push(scope);
    return this.usersResponse.asObservable();
  }

  groupNamesByUserId(): Observable<GroupNamesByUserId> {
    return this.groupsResponse.asObservable();
  }

  roleNamesByUserId(): Observable<RoleNamesByUserId> {
    return this.rolesResponse.asObservable();
  }
}

/** A stub `Session`: the page reads the role, and nothing else, from it. */
class SessionStub {
  readonly databaseRole = signal<string | null>(null);
}

const USER_ID = '0198c000-0000-7000-8000-000000000001';

function adminRow(overrides: Partial<UsersRow> = {}): UsersRow {
  return {
    id: USER_ID,
    username: 'ada',
    email: 'ada@example.org',
    created_at: '2026-01-05T09:00:00.000Z',
    deleted_at: undefined,
    deletion_reason: undefined,
    email_anonymized: undefined,
    country_code: 'DE',
    region_code: 'BE',
    city: 'Berlin',
    geo_source: 'geoip',
    geo_accuracy_km: 12,
    geo_updated_at: '2026-01-06T09:00:00.000Z',
    last_activity_at: '2026-02-03T19:12:00.000Z',
    email_verified_at: '2026-01-06T09:00:00.000Z',
    first_name: 'Ada',
    last_name: 'Lovelace',
    last_login_at: '2026-02-01T08:30:00.000Z',
    disabled_at: undefined,
    disabled_by: undefined,
    disabled_reason: undefined,
    disabled_until: undefined,
    ...overrides,
  };
}

describe('UsersPage', () => {
  let fixture: ComponentFixture<UsersPage>;
  let api: UsersApiStub;
  let session: SessionStub;

  /**
   * The role is set BEFORE the component is created, because the resource is keyed
   * on it: a role that changes afterwards legitimately re-reads, and a test about
   * which columns were requested has to say which of the two reads it means.
   */
  async function start(databaseRole: string | null): Promise<void> {
    api = new UsersApiStub();
    session = new SessionStub();
    session.databaseRole.set(databaseRole);
    await TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [{ provide: UsersApi, useValue: api }, { provide: Session, useValue: session }],
    }).compileComponents();
    fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function rowTexts(): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).map(
      (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  /** Push the three reads and let the resource settle. */
  async function settle(
    users: readonly UsersRow[],
    options: { groups?: GroupNamesByUserId; roles?: RoleNamesByUserId } = {},
  ): Promise<void> {
    api.usersResponse.next(users);
    api.groupsResponse.next(options.groups ?? new Map());
    api.rolesResponse.next(options.roles ?? new Map());
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  describe('for an administrator', () => {
    beforeEach(async () => {
      await start('app_admin');
    });

    it('asks for the wide column set', async () => {
      await settle([adminRow()]);

      expect(api.scopes).toEqual(['admin']);
    });

    it('renders a row for every user the database returned', async () => {
      await settle([
        adminRow(),
        adminRow({ id: 'u2', username: 'grace', email: 'grace@example.org', first_name: 'Grace' }),
      ]);

      expect(rowTexts()).toHaveLength(2);
      expect(text()).toContain('ada');
      expect(text()).toContain('grace@example.org');
      expect(text()).toContain('2 users returned to app_admin.');
    });

    /**
     * The two timestamps answer two different questions and their NULLs mean
     * different things. A "last seen" column would make "never signed in" and "never
     * observed" the same sentence and would let the second stand in for the first.
     */
    it('labels the credential check and the observed activity differently, and says what NULL means', async () => {
      await settle([adminRow({ last_login_at: undefined, last_activity_at: undefined })]);

      const row = rowTexts()[0] ?? '';
      expect(row).toContain('never recorded');
      expect(row).toContain('never observed');
    });

    it('shows the place with the radius that bounds it, not the city alone', async () => {
      await settle([adminRow({ geo_accuracy_km: 0.012 })]);

      const row = rowTexts()[0] ?? '';
      expect(row).toContain('Berlin, BE, DE');
      expect(row).toContain('within 12 m');
    });

    it('shows the erasure and disable evidence beside the account', async () => {
      await settle([
        adminRow({
          deleted_at: '2026-01-02T00:00:00.000Z',
          deletion_reason: 'rtbf',
          email_anonymized: true,
          disabled_at: '2026-03-01T10:00:00.000Z',
          disabled_reason: 'security',
          disabled_by: '0198c000-0000-7000-8000-0000000000ff',
          disabled_until: '2026-03-08T10:00:00.000Z',
        }),
      ]);

      const row = rowTexts()[0] ?? '';
      expect(row).toContain("erased at the member's request");
      expect(row).toContain('email address was anonymized');
      expect(row).toContain('automated security block');
      expect(row).toContain('Temporary');
    });

    it('says a name nobody has stated is unstated', async () => {
      await settle([adminRow({ first_name: undefined, last_name: undefined })]);

      expect(rowTexts()[0]).toContain('not stated');
    });

    /**
     * `email_verified_at` is a timestamp, so the page renders a timestamp and no
     * badge. A boolean built on it would claim to know whether the address is
     * verified now, which is more than the column records.
     */
    it('renders the verification column as a timestamp rather than as a flag', async () => {
      await settle([adminRow({ email_verified_at: undefined })]);

      const row = rowTexts()[0] ?? '';
      expect(row).toContain('not verified');
      expect(row).not.toMatch(/\bverified\b\s*$/);
    });

    it('shows role names, and says an unreadable table rather than showing a blank cell', async () => {
      await settle([adminRow()], {
        roles: new Map([[USER_ID, ['administrator']]]),
        groups: new Map(),
      });
      expect(text()).toContain('administrator');

      api.rolesResponse.error(new HttpErrorResponse({ status: 403 }));
      TestBed.tick();
      await Promise.resolve();
      fixture.detectChanges();

      expect(text()).toContain('Role assignments are not readable for this role');
      // The 403 takes the ROLE cell down, not the user list: the row is still there.
      expect(rowTexts()).toHaveLength(1);
    });

    it('names the role and the count next to the list, because nothing is filtered here', async () => {
      await settle([adminRow()]);

      expect(text()).toContain('1 user returned to app_admin.');
    });

    it('reports a failed read rather than showing an empty table as success', async () => {
      api.usersResponse.error(new HttpErrorResponse({ status: 403 }));
      TestBed.tick();
      await Promise.resolve();
      fixture.detectChanges();

      expect(text()).toContain('The database refused this read for the signed-in role (403).');
    });

    it('says so when the database returned no rows at all', async () => {
      await settle([]);

      expect(text()).toContain('No user rows were returned to this role.');
    });
  });

  describe('for a member, whose grant is twelve columns', () => {
    beforeEach(async () => {
      await start('app_member');
    });

    /**
     * The decision is made BEFORE the request. Naming an admin-only column is not a
     * partial answer, it is a `403` for the whole read — so the page never asks.
     */
    it('asks for the narrow column set', async () => {
      await settle([adminRow()]);

      expect(api.scopes).toEqual(['member']);
    });

    it('says the admin columns are unreadable, and says why they are absent', async () => {
      await settle([adminRow({ last_login_at: undefined })]);

      const row = rowTexts()[0] ?? '';
      expect(row).toContain('not readable for this role');
      expect(row).not.toContain('never recorded');
      expect(text()).toContain('grant on users is twelve columns');
    });

    /**
     * "No erasure and no disable recorded" would be a claim about the ACCOUNT. The
     * truth is that the columns were never read, which is a claim about the GRANT,
     * and the two must not render the same cell.
     */
    it('renders the account-state cell as unreadable rather than as an untouched account', async () => {
      await settle([
        adminRow({ disabled_at: '2026-03-01T10:00:00.000Z', disabled_reason: 'security' }),
      ]);

      const row = rowTexts()[0] ?? '';
      expect(row).toContain('not readable for this role');
      expect(row).not.toContain('No erasure and no disable recorded');
    });

    it('still shows the twelve columns it is granted', async () => {
      await settle([adminRow()]);

      const row = rowTexts()[0] ?? '';
      expect(row).toContain('Berlin, BE, DE');
      expect(row).toContain('within 12 km');
      expect(row).toContain('ada@example.org');
    });
  });

  describe('before the role is known', () => {
    it('asks for the narrow set, then widens once the identity resolves', async () => {
      await start(null);
      await settle([]);
      expect(api.scopes).toEqual(['member']);

      session.databaseRole.set('app_admin');
      fixture.detectChanges();
      TestBed.tick();
      await Promise.resolve();
      fixture.detectChanges();

      expect(api.scopes).toEqual(['member', 'admin']);
    });
  });
});