import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError, type Observable } from 'rxjs';
import { Session } from '../../../core/auth/session.service';
import { AuthorizationApi } from '../authorization-api.service';
import type {
  CapabilitySnapshot,
  GroupRow,
  PermissionRow,
  RoleRow,
  ScopeSnapshot,
  UserRow,
} from '../authorization.types';
import { RolesPage } from './roles-page';

/**
 * A hand-written `AuthorizationApi`, so these tests exercise the PAGE's decisions
 * without a server. Permitted in `*.spec.ts` only (`AGENTS.md` §2.2); the requests
 * the browser actually makes are asserted in `authorization-api.service.spec.ts`.
 */
class AuthorizationApiStub {
  scopeSnapshot: ScopeSnapshot = { groups: [], memberships: [], users: [] };
  capabilitySnapshot: CapabilitySnapshot = {
    roles: [],
    userRoles: [],
    rolePermissions: [],
    permissions: [],
  };
  scopeError: Error | null = null;
  capabilityError: Error | null = null;
  readonly calls: string[] = [];

  scope(): Observable<ScopeSnapshot> {
    const error = this.scopeError;
    return error === null ? of(this.scopeSnapshot) : throwError(() => error);
  }

  capability(): Observable<CapabilitySnapshot> {
    const error = this.capabilityError;
    return error === null ? of(this.capabilitySnapshot) : throwError(() => error);
  }

  createGroup(name: string, _parentId: string | null): Observable<void> {
    this.calls.push(`create:${name}`);
    return of(undefined);
  }

  renameGroup(groupId: string, name: string): Observable<void> {
    this.calls.push(`rename:${groupId}:${name}`);
    return of(undefined);
  }

  moveGroup(groupId: string, parentId: string): Observable<void> {
    this.calls.push(`move:${groupId}:${parentId}`);
    return of(undefined);
  }

  addMember(userId: string, groupId: string): Observable<void> {
    this.calls.push(`add:${userId}:${groupId}`);
    return of(undefined);
  }

  removeMember(userId: string, groupId: string): Observable<void> {
    this.calls.push(`remove:${userId}:${groupId}`);
    return of(undefined);
  }

  /**
   * The revoke is applied to the SNAPSHOT, not just recorded: the page re-reads
   * after a write, and what it re-reads has to be the new truth. A stub that only
   * recorded the call would leave the page rendering the old capability set, which
   * is exactly the claim this suite is about.
   */
  assignRole(userId: string, roleId: string): Observable<void> {
    this.calls.push(`assign:${userId}:${roleId}`);
    this.capabilitySnapshot = {
      ...this.capabilitySnapshot,
      userRoles: [...this.capabilitySnapshot.userRoles, { user_id: userId, role_id: roleId }],
    };
    return of(undefined);
  }

  revokeRole(userId: string, roleId: string): Observable<void> {
    this.calls.push(`revoke:${userId}:${roleId}`);
    this.capabilitySnapshot = {
      ...this.capabilitySnapshot,
      userRoles: this.capabilitySnapshot.userRoles.filter(
        (row) => !(row.user_id === userId && row.role_id === roleId),
      ),
    };
    return of(undefined);
  }
}

/** A stub `Session`: the page reads the role, and nothing else, from it. */
class SessionStub {
  readonly databaseRole = signal<string | null>(null);
}

const ROOT = 'g-root';
const EU = 'g-eu';
const ALICE = 'u-alice';
const ADMIN_ROLE = 'r-admin';
const MANAGER_ROLE = 'r-manager';

function group(id: string, name: string, parentId: string | null): GroupRow {
  return {
    id,
    name,
    parent_id: parentId ?? undefined,
    is_system_group: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function user(id: string, username: string): UserRow {
  return { id, username, email: `${username}@example.test` };
}

function role(id: string, name: string, parentId: string | null): RoleRow {
  return { id, name, parent_id: parentId ?? undefined, is_system_role: false };
}

const PROJECT_READ: PermissionRow = { id: 'p-project-read', resource: 'project', action_id: 'read' };
const CUSTOMER_READ: PermissionRow = { id: 'p-customer-read', resource: 'customer', action_id: 'read' };

const SCOPE: ScopeSnapshot = {
  groups: [group(ROOT, 'root', null), group(EU, 'EU', ROOT)],
  memberships: [{ user_id: ALICE, group_id: EU }],
  users: [user(ALICE, 'alice')],
};

const CAPABILITY: CapabilitySnapshot = {
  roles: [role(ADMIN_ROLE, 'admin', null), role(MANAGER_ROLE, 'manager', ADMIN_ROLE)],
  userRoles: [{ user_id: ALICE, role_id: MANAGER_ROLE }],
  rolePermissions: [
    { role_id: ADMIN_ROLE, permission_id: PROJECT_READ.id },
    { role_id: ADMIN_ROLE, permission_id: CUSTOMER_READ.id },
    { role_id: MANAGER_ROLE, permission_id: PROJECT_READ.id },
  ],
  permissions: [PROJECT_READ, CUSTOMER_READ],
};

describe('RolesPage', () => {
  let fixture: ComponentFixture<RolesPage>;
  let api: AuthorizationApiStub;
  let session: SessionStub;

  /**
   * Whether anything has asked for an `HttpClient`.
   *
   * `HttpClient` is `providedIn: 'root'`, so it is always INJECTABLE and a test
   * cannot prove the point by failing to resolve it. What it CAN do is notice
   * that somebody WANTS it: the provider below is a factory, and a factory runs
   * only when the token is injected. So this flag is the evidence.
   */
  let httpRequested = false;

  async function start(
    databaseRole: string | null,
    failures: { readonly scope?: Error; readonly capability?: Error } = {},
  ): Promise<void> {
    api = new AuthorizationApiStub();
    api.scopeSnapshot = SCOPE;
    api.capabilitySnapshot = CAPABILITY;
    api.scopeError = failures.scope ?? null;
    api.capabilityError = failures.capability ?? null;
    session = new SessionStub();
    session.databaseRole.set(databaseRole);
    httpRequested = false;
    await TestBed.configureTestingModule({
      imports: [RolesPage],
      providers: [
        { provide: AuthorizationApi, useValue: api },
        { provide: Session, useValue: session },
        {
          provide: HttpClient,
          useFactory: () => {
            httpRequested = true;
            return {};
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RolesPage);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /**
   * The group's own panel: the roles its members hold, and the capabilities those
   * members hold. Asserted on THIS and not on the whole page, because the role
   * table above it names the same capabilities for the roles themselves — a role
   * carries what it carries whether or not anybody holds it.
   */
  function groupPanelText(): string {
    return element().querySelector('.panel')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function buttonNamed(name: string): HTMLButtonElement | undefined {
    return Array.from(element().querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === name,
    );
  }

  async function click(button: HTMLButtonElement | undefined): Promise<void> {
    button?.click();
    await settle();
  }

  async function chooseGroup(groupId: string): Promise<void> {
    const select = element().querySelector<HTMLSelectElement>('#roles-group');
    expect(select).not.toBeNull();
    if (select === null) {
      return;
    }
    select.value = groupId;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  describe('for an administrator', () => {
    beforeEach(async () => {
      await start('app_admin');
    });

    it('lists the roles with what they carry directly and what they may do', () => {
      const row = Array.from(element().querySelectorAll('tbody tr')).find((candidate) =>
        candidate.textContent?.includes('manager'),
      );
      const rendered = row?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

      // The parent, the direct grant and the inherited set, in three columns.
      expect(rendered).toContain('admin');
      expect(rendered).toContain('project:read');
      // The manager inherits `customer:read` from the admin role above it.
      expect(rendered).toContain('customer:read');
    });

    it('says what a group holds, and that the answer is derived from its members', async () => {
      await chooseGroup(EU);

      expect(text()).toContain('Roles held by the members of EU');
      expect(text()).toContain("DERIVED from the group's MEMBERSHIP");
      expect(text()).toContain('manager');
    });

    it('shows the capabilities the group’s members hold, as a derivation', async () => {
      await chooseGroup(EU);

      expect(groupPanelText()).toContain('Capabilities held by the members of EU');
      expect(groupPanelText()).toContain('project:read');
      expect(groupPanelText()).toContain('customer:read');
    });

    /**
     * The brief's test: revoking a role from a group changes the group's
     * capabilities. It is a DERIVED set, so it changes the moment the role
     * assignment changes — and it changes because the members' capabilities
     * changed, not because the group holds anything.
     */
    it('changes the group’s capabilities when a role is revoked from one of its members', async () => {
      await chooseGroup(EU);
      expect(groupPanelText()).toContain('project:read');

      await click(buttonNamed('Revoke'));

      expect(api.calls).toContain(`revoke:${ALICE}:${MANAGER_ROLE}`);
      // The group's derived capability set has changed with the assignment.
      expect(groupPanelText()).not.toContain('project:read');
      expect(groupPanelText()).not.toContain('customer:read');
      // And the scope did not: Alice is still in the group.
      expect(text()).toContain('alice');
    });

    it('shows a member’s scope and capability as two separate columns', async () => {
      await chooseGroup(EU);
      await click(buttonNamed('alice'));

      expect(text()).toContain('Scope — which rows');
      expect(text()).toContain('Capability — which objects');
      expect(text()).toContain('a role grants capability and never scope');
    });

    it('offers the administration actions to an administrator, once a group is chosen', async () => {
      await chooseGroup(EU);

      expect(buttonNamed('Assign')).toBeDefined();
      expect(buttonNamed('Revoke')).toBeDefined();
    });
  });

  describe('for a member', () => {
    it('is offered no write controls', async () => {
      await start('app_member');
      await chooseGroup(EU);

      expect(buttonNamed('Revoke')).toBeUndefined();
      expect(buttonNamed('Assign')).toBeUndefined();
    });

    it('says the capability axis is not readable, rather than showing it as empty', async () => {
      await start('app_member', { capability: new HttpErrorResponse({ status: 403 }) });

      expect(text()).toContain('The capability axis is not readable for the signed-in role (403).');
    });
  });

  describe('the component itself', () => {
    beforeEach(async () => {
      await start('app_admin');
    });

    /**
     * `AGENTS.md` §F4: HTTP lives in services only. The `HttpClient` provider here
     * is a FACTORY, and a factory runs only when the token is injected — so if
     * this component injected one, the flag would be set by the time it was
     * created. It is not.
     */
    it('owns no HTTP: nothing in this page asked for an HttpClient', () => {
      expect(httpRequested).toBe(false);
    });
  });
});

