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
import { GroupsPage } from './groups-page';

/**
 * A hand-written `AuthorizationApi`, so these tests exercise the PAGE's decisions
 * — what it renders, what it offers, and what it says when the database refuses
 * — without a server. Permitted in `*.spec.ts` only (`AGENTS.md` §2.2); the
 * requests the browser actually makes are asserted in
 * `authorization-api.service.spec.ts` instead, against `HttpTestingController`.
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
  moveError: Error | null = null;
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
    const error = this.moveError;
    return error === null ? of(undefined) : throwError(() => error);
  }

  addMember(userId: string, groupId: string): Observable<void> {
    this.calls.push(`add:${userId}:${groupId}`);
    return of(undefined);
  }

  removeMember(userId: string, groupId: string): Observable<void> {
    this.calls.push(`remove:${userId}:${groupId}`);
    return of(undefined);
  }

  assignRole(userId: string, roleId: string): Observable<void> {
    this.calls.push(`assign:${userId}:${roleId}`);
    return of(undefined);
  }

  revokeRole(userId: string, roleId: string): Observable<void> {
    this.calls.push(`revoke:${userId}:${roleId}`);
    return of(undefined);
  }
}

/** A stub `Session`: the page reads the role, and nothing else, from it. */
class SessionStub {
  readonly databaseRole = signal<string | null>(null);
}

const ROOT = 'g-root';
const EU = 'g-eu';
const FR = 'g-fr';
const ALICE = 'u-alice';

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

const ADMIN_ROLE = 'r-admin';
const MANAGER_ROLE = 'r-manager';

function role(id: string, name: string, parentId: string | null): RoleRow {
  return { id, name, parent_id: parentId ?? undefined, is_system_role: false };
}

const PROJECT_READ: PermissionRow = { id: 'p-project-read', resource: 'project', action_id: 'read' };
const CUSTOMER_READ: PermissionRow = { id: 'p-customer-read', resource: 'customer', action_id: 'read' };

const SCOPE: ScopeSnapshot = {
  groups: [group(ROOT, 'root', null), group(EU, 'EU', ROOT), group(FR, 'FR', EU)],
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

describe('GroupsPage', () => {
  let fixture: ComponentFixture<GroupsPage>;
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

  /**
   * `start` takes the failures the stub should answer with, because a resource
   * reads ONCE: an error delivered after the first read would never be seen.
   */
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
      imports: [GroupsPage],
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
    fixture = TestBed.createComponent(GroupsPage);
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

  function treeRows(): readonly { readonly name: string; readonly depth: string }[] {
    return Array.from(element().querySelectorAll('.tree__row')).map((row) => {
      const name = row.querySelector('.tree__name');
      return {
        name: name?.textContent?.trim() ?? '',
        depth: name instanceof HTMLElement ? name.style.paddingLeft : '',
      };
    });
  }

  function buttonNamed(text_: string): HTMLButtonElement | undefined {
    return Array.from(element().querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === text_,
    );
  }

  /**
   * A tree row, by the group's NAME.
   *
   * The row's button carries the name and two pieces of metadata, so it cannot be
   * found by its text alone.
   */
  function treeRowNamed(name: string): HTMLButtonElement | undefined {
    return Array.from(element().querySelectorAll<HTMLButtonElement>('.tree__row')).find(
      (row) => row.querySelector('.tree__name')?.textContent?.trim() === name,
    );
  }

  async function click(button: HTMLButtonElement | undefined): Promise<void> {
    button?.click();
    await settle();
  }

  describe('for an administrator', () => {
    beforeEach(async () => {
      await start('app_admin');
    });

    /**
     * The tree IS the closure, rendered: the hierarchy the database materialises
     * into `authz.org_closure` is the parent links, and a nested group has to
     * appear as a nested row.
     */
    it('renders the group tree, and a nested group is nested', () => {
      const rows = treeRows();

      expect(rows.map((row) => row.name)).toEqual(['root', 'EU', 'FR']);
      // FR is two levels below root, and the depth is the indentation.
      expect(rows[0]?.depth).toBe('0rem');
      expect(rows[1]?.depth).toBe('1.25rem');
      expect(rows[2]?.depth).toBe('2.5rem');
    });

    it('names the parent of each group, and the member count', () => {
      const rows = Array.from(element().querySelectorAll('.tree__row')).map(
        (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );

      expect(rows[2]).toContain('under EU');
      expect(rows[0]).toContain('under root group');
    });

    it('shows the members of the selected group', async () => {
      await click(treeRowNamed('EU'));

      expect(text()).toContain('alice');
    });

    /**
     * The brief's "their members, and their roles". The roles are the MEMBERS'
     * roles: a role is held by a person, and nothing associates one with a group,
     * so the page says where the answer comes from.
     */
    it('names the roles held by the group’s members, and says they are derived', async () => {
      await click(treeRowNamed('EU'));

      expect(text()).toContain("The roles held by this group's MEMBERS");
      expect(text()).toContain('manager');
    });

    it('shows a member’s scope and capability as two separate columns', async () => {
      await click(treeRowNamed('EU'));
      await click(buttonNamed('alice'));

      // The two axes, separately, and the join stated above them.
      expect(text()).toContain('Scope — which rows');
      expect(text()).toContain('Capability — which objects');
      expect(text()).toContain('a role grants capability and never scope');
      // The scope is the group and its subtree; the capability is the role's own
      // plus what it inherits.
      expect(text()).toContain('FR');
      expect(text()).toContain('project:read');
      expect(text()).toContain('customer:read');
    });

    it('offers the administration actions to an administrator, for the selected group', async () => {
      await click(treeRowNamed('EU'));

      expect(buttonNamed('Create')).toBeDefined();
      expect(buttonNamed('Rename')).toBeDefined();
      expect(buttonNamed('Move')).toBeDefined();
    });

    it('sends a rename to the service', async () => {
      await click(treeRowNamed('EU'));

      const input = element().querySelector<HTMLInputElement>('#group-rename');
      expect(input).not.toBeNull();
      if (input === null) {
        return;
      }
      input.value = 'Europe';
      input.dispatchEvent(new Event('input'));
      await settle();

      await click(buttonNamed('Rename'));

      expect(api.calls).toContain(`rename:${EU}:Europe`);
    });

    /**
     * The database refuses a move that would close a loop, and it says what it
     * refused. The page does not pre-judge the move, so the refusal reaches the
     * administrator with the database's own words.
     */
    it('shows the database’s refusal of a cycle, in the database’s words', async () => {
      api.moveError = new HttpErrorResponse({
        status: 400,
        error: {
          code: '23514',
          message: `group cycle: ${ROOT} cannot be parented to ${FR}, which is itself or a descendant of ${ROOT}`,
          details: null,
          hint: null,
        },
      });
      await click(treeRowNamed('EU'));

      const select = element().querySelector<HTMLSelectElement>('#group-move');
      expect(select).not.toBeNull();
      if (select === null) {
        return;
      }
      select.value = FR;
      select.dispatchEvent(new Event('change'));
      await settle();

      await click(buttonNamed('Move'));

      expect(text()).toContain('The database refused move the group');
      expect(text()).toContain('group cycle');
      expect(text()).toContain('cannot be parented to');
    });

    it('sends a move to the service, and does not judge it first', async () => {
      await click(treeRowNamed('FR'));

      const select = element().querySelector<HTMLSelectElement>('#group-move');
      expect(select).not.toBeNull();
      if (select === null) {
        return;
      }
      // The picker offers EVERY group, including one that would close a loop: the
      // cycle rule belongs to the database and to nothing else.
      const options = Array.from(select.options).map((option) => option.value);
      expect(options).toContain(ROOT);
      select.value = ROOT;
      select.dispatchEvent(new Event('change'));
      await settle();

      await click(buttonNamed('Move'));

      expect(api.calls).toContain(`move:${FR}:${ROOT}`);
    });

    it('adds and removes a member through the service', async () => {
      await click(treeRowNamed('EU'));

      await click(buttonNamed('Remove'));

      expect(api.calls).toContain(`remove:${ALICE}:${EU}`);
    });
  });

  describe('for a member', () => {
    beforeEach(async () => {
      await start('app_member');
    });

    it('is offered no write controls, because the database refuses the write anyway', () => {
      expect(buttonNamed('Create')).toBeUndefined();
      expect(buttonNamed('Rename')).toBeUndefined();
      expect(buttonNamed('Move')).toBeUndefined();
    });

    it('still shows the scope axis it is granted', () => {
      expect(treeRows().map((row) => row.name)).toEqual(['root', 'EU', 'FR']);
    });
  });

  describe('when the capability axis is refused', () => {
    beforeEach(async () => {
      await start('app_member', { capability: new HttpErrorResponse({ status: 403 }) });
    });

    it('says the capability axis is not readable, rather than showing it as empty', () => {
      expect(text()).toContain('The capability axis is not readable for the signed-in role (403).');
    });

    it('still shows the scope axis, because one refusal does not take the other down', () => {
      expect(treeRows().map((row) => row.name)).toEqual(['root', 'EU', 'FR']);
    });
  });

  describe('the component itself', () => {
    beforeEach(async () => {
      await start('app_admin');
    });

    /**
     * `AGENTS.md` §F4: "HTTP calls live in services only. A component that injects
     * `HttpClient` is an architectural violation."
     *
     * The `HttpClient` provider in this file is a FACTORY, and a factory runs only
     * when the token is injected. The component was created, so if it had injected
     * one the factory would have run. It did not. The same rule is enforced for
     * every component in the application by the `no-restricted-syntax` rule in
     * `frontend/eslint.config.js`.
     */
    it('owns no HTTP: nothing in this page asked for an HttpClient', () => {
      expect(httpRequested).toBe(false);
    });
  });
});


