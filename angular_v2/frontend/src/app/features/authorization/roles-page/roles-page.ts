import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { lastValueFrom, type Observable } from 'rxjs';
import { Session } from '../../../core/auth/session.service';
import { describeAuthorizationFailure } from '../authorization-failure';
import {
  groupCapabilities,
  groupTree,
  memberCapabilities,
  memberScope,
  roleViews,
  rolesHeldByGroup,
  rolesHeldByUser,
} from '../authorization-model';
import type { RoleRow, UserRow } from '../authorization.types';
import { AuthorizationApi } from '../authorization-api.service';
import { MemberAccess } from '../member-access/member-access';

/** A member of the selected group, with the roles they hold. */
interface MemberRoleRow {
  readonly user: UserRow;
  readonly roles: readonly RoleRow[];
}

/**
 * `/admin/roles` — the CAPABILITY axis, administered.
 *
 * ## WHAT THIS PAGE ANSWERS
 *
 *   * What roles exist, and how are they nested?
 *   * What may each role do — directly, and including what it inherits?
 *   * Which roles do the members of a group hold?
 *   * How do I assign a role and revoke one?
 *
 * ## "THE ROLES A GROUP HOLDS" IS A QUESTION ABOUT THE GROUP'S MEMBERS
 *
 * The brief for this work asked for "the roles each group holds", and for a way to
 * assign a role to a group. The schema has no such thing, and it must not grow
 * one: a role is CAPABILITY and a group is SCOPE, and a table in which the two
 * appear on one row is the arrangement ADR-0023 records as the one that fails
 * silently — nothing would resolve it, and a role would appear to grant a scope.
 * So the answer this page gives is the one the model can actually answer:
 *
 *   * **the roles the members of a group hold** — a derivation over the
 *     membership, which changes when a membership or a role assignment changes;
 *   * **assigning a role to a person** — the only place a role can be put, which
 *     is `user_roles`, and which is what changes the group's derived set.
 *
 * The section is labelled as derived, in the same words, so that nobody reads it
 * as "this group has the `manager` role".
 *
 * ## THE GRANT IS CHECKED BY THE DATABASE
 *
 * `assert_grant_subset()` refuses a grant the grantor does not itself hold, so an
 * administrator who tries to confer a capability it does not have is refused by
 * the database, with the database's own message. The page does not pre-judge that
 * either.
 */
@Component({
  selector: 'app-roles-page',
  standalone: true,
  imports: [MatCardModule, MatProgressBarModule, MemberAccess],
  templateUrl: './roles-page.html',
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

    .table {
      width: 100%;
      border-collapse: collapse;
    }

    .table th,
    .table td {
      text-align: left;
      padding: 0.4rem 0.75rem 0.4rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }

    .table thead th {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    .capabilities {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .capability {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 999px;
      padding: 0 0.45rem;
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

    code {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
  `,
})
export class RolesPage {
  private readonly api = inject(AuthorizationApi);
  private readonly session = inject(Session);

  private readonly scopeResource = rxResource({ stream: () => this.api.scope() });
  private readonly capabilityResource = rxResource({ stream: () => this.api.capability() });

  protected readonly selectedGroupId = signal<string | null>(null);
  protected readonly selectedUserId = signal<string | null>(null);
  protected readonly roleToAssign = signal('');
  protected readonly failureReason = signal<string | null>(null);
  protected readonly busy = signal(false);

  /**
   * Whether the write controls are offered.
   *
   * A UX affordance, not access control (`AGENTS.md` §F7): the capability tables
   * are admin-only at the table level, so the database refuses a write from any
   * other role whatever this page renders.
   */
  protected readonly canAdminister = computed(() => this.session.databaseRole() === 'app_admin');

  protected readonly loading = computed(
    () => this.scopeResource.isLoading() || this.capabilityResource.isLoading(),
  );

  /** The role table: each role with its own and its effective capabilities. */
  protected readonly roleTable = computed(() => {
    const capability = this.capabilityResource.hasValue()
      ? this.capabilityResource.value()
      : undefined;
    return capability === undefined ? [] : roleViews(capability);
  });

  /** The groups, for the picker. */
  protected readonly groups = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    return scope === undefined ? [] : groupTree(scope.groups, scope.memberships);
  });

  protected readonly selectedGroup = computed(
    () => this.groups().find((row) => row.id === this.selectedGroupId()) ?? null,
  );

  /**
   * The roles held by the members of the selected group.
   *
   * DERIVED from the membership, and labelled as such on the page: nothing
   * associates a role with a group, and nothing may.
   */
  protected readonly groupRoles = computed(() => {
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

  /** The capabilities held by the members of the selected group. */
  protected readonly groupCapabilitySet = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const capability = this.capabilityResource.hasValue()
      ? this.capabilityResource.value()
      : undefined;
    const groupId = this.selectedGroupId();
    if (scope === undefined || capability === undefined || groupId === null) {
      return [];
    }
    return groupCapabilities(
      groupId,
      scope.memberships,
      capability.userRoles,
      capability.roles,
      capability.rolePermissions,
      capability.permissions,
    );
  });

  /** The members of the selected group, each with the roles they hold. */
  protected readonly members = computed<readonly MemberRoleRow[]>(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const capability = this.capabilityResource.hasValue()
      ? this.capabilityResource.value()
      : undefined;
    const groupId = this.selectedGroupId();
    if (scope === undefined || capability === undefined || groupId === null) {
      return [];
    }
    const memberIds = new Set(
      scope.memberships.filter((row) => row.group_id === groupId).map((row) => row.user_id),
    );
    return scope.users
      .filter((user) => memberIds.has(user.id))
      .map((user) => ({
        user,
        roles: rolesHeldByUser(user.id, capability.userRoles, capability.roles),
      }));
  });

  protected readonly selectedMemberName = computed(() => {
    const scope = this.scopeResource.hasValue() ? this.scopeResource.value() : undefined;
    const userId = this.selectedUserId();
    if (scope === undefined || userId === null) {
      return null;
    }
    return scope.users.find((user) => user.id === userId)?.username ?? null;
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

  protected readonly scopeFailure = computed(() => {
    const error = this.scopeResource.error();
    if (error === undefined) {
      return null;
    }
    return error instanceof HttpErrorResponse && error.status === 403
      ? 'The database refused this read for the signed-in role (403).'
      : `The scope read failed: HTTP ${statusOf(error)}`;
  });

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
    const count = this.roleTable().length;
    return `${String(count)} ${count === 1 ? 'role' : 'roles'} returned to ${this.session.databaseRole() ?? 'the signed-in role'}.`;
  });

  protected selectGroup(groupId: string): void {
    this.selectedGroupId.set(groupId);
    this.selectedUserId.set(null);
    this.roleToAssign.set('');
  }

  protected selectMember(userId: string): void {
    this.selectedUserId.set(userId);
  }

  protected onGroupChange(event: Event): void {
    this.selectGroup((event.target as HTMLSelectElement).value);
  }

  protected onRoleToAssign(event: Event): void {
    this.roleToAssign.set((event.target as HTMLSelectElement).value);
  }

  protected async assignRole(userId: string): Promise<void> {
    const roleId = this.roleToAssign();
    if (roleId === '') {
      this.failureReason.set('Choose a role to assign.');
      return;
    }
    await this.write('assign the role', () => this.api.assignRole(userId, roleId));
  }

  protected async revokeRole(userId: string, roleId: string): Promise<void> {
    await this.write('revoke the role', () => this.api.revokeRole(userId, roleId));
  }

  /**
   * One write, one error path, one reload.
   *
   * A revoked role changes the CAPABILITY of the member and of nobody else, and
   * the reload re-reads both axes so that the derived set on this page is the
   * database's answer and not the page's memory of it.
   */
  private async write(subject: string, work: () => Observable<void>): Promise<void> {
    this.busy.set(true);
    this.failureReason.set(null);
    try {
      await lastValueFrom(work());
      this.scopeResource.reload();
      this.capabilityResource.reload();
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
