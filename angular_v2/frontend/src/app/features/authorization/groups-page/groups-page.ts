import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { lastValueFrom, type Observable } from 'rxjs';
import { Session } from '../../../core/auth/session.service';
import { describeAuthorizationFailure } from '../authorization-failure';
import {
  groupTree,
  memberCapabilities,
  memberScope,
  rolesHeldByGroup,
} from '../authorization-model';
import { AuthorizationApi } from '../authorization-api.service';
import { MemberAccess } from '../member-access/member-access';

/**
 * `/admin/groups` — the SCOPE axis, administered.
 *
 * ## WHAT THIS PAGE ANSWERS
 *
 *   * What groups exist, and how are they nested? (the tree)
 *   * Who is in a group?
 *   * What can one of its members do? (the effective-access panel)
 *   * How do I create a group, rename it, move it, and add or remove a member?
 *
 * ## THE TREE IS THE CLOSURE, RENDERED
 *
 * The hierarchy is `groups.parent_id`, which the database materialises into
 * `authz.org_closure` so that the SCOPE POLICY can join it once per statement
 * instead of walking the tree per candidate row. The closure itself lives in the
 * `authz` schema, deliberately outside `db-schemas`, so PostgREST cannot address
 * it — a relation in `public` with a `SELECT` grant is one `GET` away from every
 * tenant's org chart. So the tree here is built from the parent links, which is
 * the same relation: a nested group appears as a nested row, and the group a
 * membership carries is the group's whole subtree.
 *
 * ## A MOVE IS ASKED, NOT JUDGED
 *
 * Moving a group under one of its own descendants would close a loop in the
 * hierarchy, and the database refuses that with a `check_violation` naming the
 * group and the refused parent. This page does NOT re-implement the rule: the
 * parent picker offers every group, including one that would close a loop, and
 * the refusal is what the administrator sees. A client-side copy of the rule
 * would be a second mechanism that eventually disagrees with the first
 * (`AGENTS.md` §2.1) — and the database's rule is the one that keeps
 * `authz.org_closure` meaning what every scope decision assumes it means.
 *
 * ## WHO MAY WRITE
 *
 * The write controls are offered to an administrator and hidden from anyone else,
 * which is a UX affordance and not access control (`AGENTS.md` §F7): `app_member`
 * holds no write verb on `groups` or `user_groups`, so the database refuses the
 * write whatever this page renders. The page is still reachable by a member who
 * types the URL, and it shows them what their role may read — the same bargain
 * the existing administration pages strike.
 */
@Component({
  selector: 'app-groups-page',
  standalone: true,
  imports: [MatCardModule, MatProgressBarModule, MemberAccess],
  templateUrl: './groups-page.html',
  styles: `
    :host {
      display: block;
    }

    .page {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .axis-note {
      margin: 0 0 0.75rem;
      max-width: 52rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .section__title {
      margin: 1rem 0 0.5rem;
      font: var(--mat-sys-title-small);
    }

    .tree {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
    }

    .tree__row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.75rem;
      width: 100%;
      padding: 0.45rem 0.75rem;
      border: 0;
      background: transparent;
      color: inherit;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .tree__row--selected {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .tree__name {
      font: var(--mat-sys-body-large);
    }

    .tree__meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .tree__system {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 999px;
      padding: 0 0.4rem;
      font: var(--mat-sys-label-small);
    }

    .panel {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
    }

    .field {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .field__label {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    .field__input,
    .field__select {
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 0.35rem;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
    }

    .button {
      padding: 0.35rem 0.9rem;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 0.35rem;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      cursor: pointer;
    }

    .button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .members {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .capabilities {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
      margin: 0 0 0.75rem;
      padding: 0;
      list-style: none;
    }

    .capability {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 999px;
      padding: 0 0.45rem;
      font: var(--mat-sys-label-small);
    }

    .member {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      padding: 0.35rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .member--selected {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }

    .notice {
      margin: 0 0 0.75rem;
      max-width: 52rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }

    .empty {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class GroupsPage {
  private readonly api = inject(AuthorizationApi);
  private readonly session = inject(Session);

  private readonly scopeResource = rxResource({ stream: () => this.api.scope() });
  private readonly capabilityResource = rxResource({ stream: () => this.api.capability() });

  protected readonly selectedGroupId = signal<string | null>(null);
  protected readonly selectedUserId = signal<string | null>(null);
  protected readonly newGroupName = signal('');
  protected readonly newGroupParentId = signal('');
  protected readonly renameValue = signal('');
  protected readonly moveParentId = signal('');
  protected readonly memberToAdd = signal('');
  protected readonly failureReason = signal<string | null>(null);
  protected readonly busy = signal(false);

  /**
   * Whether the write controls are offered.
   *
   * A UX affordance, not access control: the database refuses a write from any
   * role other than `app_admin` in either case (`AGENTS.md` §F7).
   */
  protected readonly canAdminister = computed(() => this.session.databaseRole() === 'app_admin');

  protected readonly loading = computed(
    () => this.scopeResource.isLoading() || this.capabilityResource.isLoading(),
  );

  /** The tree, flattened depth-first. Empty until the scope axis has been read. */
  protected readonly tree = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    return scope === undefined ? [] : groupTree(scope.groups, scope.memberships);
  });

  protected readonly selectedGroup = computed(
    () => this.tree().find((row) => row.id === this.selectedGroupId()) ?? null,
  );

  /** The members of the selected group. */
  protected readonly members = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const groupId = this.selectedGroupId();
    if (scope === undefined || groupId === null) {
      return [];
    }
    const memberIds = new Set(
      scope.memberships.filter((row) => row.group_id === groupId).map((row) => row.user_id),
    );
    return scope.users.filter((user) => memberIds.has(user.id));
  });

  /** The people who are NOT in the selected group — the candidates for adding. */
  protected readonly candidates = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const groupId = this.selectedGroupId();
    if (scope === undefined || groupId === null) {
      return [];
    }
    const memberIds = new Set(
      scope.memberships.filter((row) => row.group_id === groupId).map((row) => row.user_id),
    );
    return scope.users.filter((user) => !memberIds.has(user.id));
  });

  protected readonly selectedMemberName = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const userId = this.selectedUserId();
    if (scope === undefined || userId === null) {
      return null;
    }
    return scope.users.find((user) => user.id === userId)?.username ?? null;
  });

  /**
   * The roles held by the members of the selected group.
   *
   * DERIVED from the membership, and labelled as such on the page: nothing
   * associates a role with a group, and nothing may — a role is CAPABILITY and a
   * group is SCOPE, and a table in which the two appear on one row is the
   * arrangement ADR-0023 records as the one that fails silently. What this
   * answers is "what roles do the people in this group hold", which is a fact
   * about the MEMBERSHIP and changes the moment a membership or a role
   * assignment changes.
   */
  protected readonly selectedGroupRoles = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const capability = this.capabilityResource.hasValue()
      ? this.capabilityResource.value()
      : undefined;
    const groupId = this.selectedGroupId();
    if (scope === undefined || capability === undefined || groupId === null) {
      return [];
    }
    return rolesHeldByGroup(groupId, scope.memberships, capability.userRoles, capability.roles);
  });

  /** The scope axis of the selected member, or `null` when it could not be read. */
  protected readonly selectedMemberScope = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const userId = this.selectedUserId();
    if (scope === undefined || userId === null) {
      return null;
    }
    return memberScope(userId, scope.memberships, scope.groups);
  });

  /** The capability axis of the selected member, or `null` when it could not be read. */
  protected readonly selectedMemberCapabilities = computed(() => {
    const capability = this.capabilityResource.hasValue()
      ? this.capabilityResource.value()
      : undefined;
    const userId = this.selectedUserId();
    if (capability === undefined || userId === null) {
      return null;
    }
    return memberCapabilities(
      userId,
      capability.userRoles,
      capability.roles,
      capability.rolePermissions,
      capability.permissions,
    );
  });

  /**
   * Whether the effective-access panel can be rendered at all.
   *
   * Both axes have to have SETTLED — read, or refused. Rendering the panel while
   * the capability read is still in flight would say "no capabilities" about a
   * person who has some, and "no capabilities" is a claim about a person rather
   * than about a request.
   */
  protected readonly accessSettled = computed(() => {
    const scope = this.scopeResource.hasValue() || this.scopeResource.error() !== undefined;
    const capability =
      this.capabilityResource.hasValue() || this.capabilityResource.error() !== undefined;
    return scope && capability;
  });

  /** The scope read failed — with what, and is it a refusal of the ROLE. */
  protected readonly scopeFailure = computed(() => {
    const error = this.scopeResource.error();
    if (error === undefined) {
      return null;
    }
    return error instanceof HttpErrorResponse && error.status === 403
      ? 'The database refused this read for the signed-in role (403).'
      : `The scope read failed: HTTP ${statusOf(error)}`;
  });

  /** The capability read failed — the capability axis is admin-only at the table level. */
  protected readonly capabilityFailure = computed(() => {
    const error = this.capabilityResource.error();
    if (error === undefined) {
      return null;
    }
    return error instanceof HttpErrorResponse && error.status === 403
      ? 'The capability axis is not readable for the signed-in role (403).'
      : `The capability read failed: HTTP ${statusOf(error)}`;
  });

  protected readonly summary = computed(() => {
    const count = this.tree().length;
    return `${String(count)} ${count === 1 ? 'group' : 'groups'} returned to ${this.session.databaseRole() ?? 'the signed-in role'}.`;
  });

  protected selectGroup(groupId: string): void {
    this.selectedGroupId.set(groupId);
    this.selectedUserId.set(null);
    this.renameValue.set(this.selectedGroup()?.name ?? '');
    this.moveParentId.set(this.selectedGroup()?.parentId ?? '');
    this.memberToAdd.set('');
  }

  protected selectMember(userId: string): void {
    this.selectedUserId.set(userId);
  }

  protected onNewGroupName(event: Event): void {
    this.newGroupName.set((event.target as HTMLInputElement).value);
  }

  protected onNewGroupParent(event: Event): void {
    this.newGroupParentId.set((event.target as HTMLSelectElement).value);
  }

  protected onRename(event: Event): void {
    this.renameValue.set((event.target as HTMLInputElement).value);
  }

  protected onMoveParent(event: Event): void {
    this.moveParentId.set((event.target as HTMLSelectElement).value);
  }

  protected onMemberToAdd(event: Event): void {
    this.memberToAdd.set((event.target as HTMLSelectElement).value);
  }

  protected async createGroup(): Promise<void> {
    const name = this.newGroupName().trim();
    if (name === '') {
      this.failureReason.set('A group needs a name.');
      return;
    }
    const parentId = this.newGroupParentId() === '' ? null : this.newGroupParentId();
    await this.write('create the group', () => this.api.createGroup(name, parentId));
    this.newGroupName.set('');
  }

  protected async renameSelectedGroup(): Promise<void> {
    const group = this.selectedGroup();
    const name = this.renameValue().trim();
    if (group === null) {
      return;
    }
    if (name === '') {
      this.failureReason.set('A group needs a name.');
      return;
    }
    await this.write('rename the group', () => this.api.renameGroup(group.id, name));
  }

  protected async moveSelectedGroup(): Promise<void> {
    const group = this.selectedGroup();
    const parentId = this.moveParentId();
    if (group === null || parentId === '') {
      return;
    }
    await this.write('move the group', () => this.api.moveGroup(group.id, parentId));
  }

  protected async addMember(): Promise<void> {
    const group = this.selectedGroup();
    const userId = this.memberToAdd();
    if (group === null || userId === '') {
      return;
    }
    await this.write('add the member', () => this.api.addMember(userId, group.id));
    this.memberToAdd.set('');
  }

  protected async removeMember(userId: string): Promise<void> {
    const group = this.selectedGroup();
    if (group === null) {
      return;
    }
    await this.write('remove the member', () => this.api.removeMember(userId, group.id));
    if (this.selectedUserId() === userId) {
      this.selectedUserId.set(null);
    }
  }

  /**
   * One write, one error path, one reload.
   *
   * The failure is rendered with the DATABASE's own words where it has them —
   * `group cycle: … cannot be parented to …` — because that sentence names what
   * was refused, and an administrator cannot act on "the move was rejected".
   */
  private async write(subject: string, work: () => Observable<void>): Promise<void> {
    this.busy.set(true);
    this.failureReason.set(null);
    try {
      await lastValueFrom(work());
      this.scopeResource.reload();
    } catch (error) {
      this.failureReason.set(describeAuthorizationFailure(error, subject));
    } finally {
      this.busy.set(false);
    }
  }
}

function statusOf(error: unknown): string {
  return error instanceof HttpErrorResponse ? `HTTP ${error.status}` : 'the request could not be completed';
}
