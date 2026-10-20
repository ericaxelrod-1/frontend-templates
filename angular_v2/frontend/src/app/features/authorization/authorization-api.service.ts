import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { forkJoin, map, type Observable } from 'rxjs';
import { POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import type {
  CapabilitySnapshot,
  GroupCreate,
  GroupMove,
  GroupRow,
  MembershipRow,
  PermissionRow,
  RolePermissionRow,
  RoleRow,
  ScopeSnapshot,
  UserRoleRow,
  UserRow,
} from './authorization.types';

/**
 * Every read and every write the two administration surfaces make.
 *
 * ## THE WRITE PATH, AND WHY IT IS POSTGREST
 *
 * The administration writes to `groups`, `user_groups`, `roles`, `user_roles` and
 * `role_permissions` — all base tables, all served by PostgREST, and the same
 * path every other table write in this application takes. `AGENTS.md` §B1 says
 * PostgREST serves base tables and that a controller must not be added for
 * anything expressible as CRUD over a table; a group, a membership and a role
 * assignment are exactly that.
 *
 * The requests carry the administrator's OWN token, and the token's `role` claim
 * is what PostgREST impersonates (`AGENTS.md` §B5). So the write lands as
 * `app_admin` — the superset principal — and it lands INSIDE the policies: the
 * scope axis is still enforced by `row_scope`, and the capability axis is still
 * enforced by `assert_grant_subset()`, which refuses a grant the grantor does not
 * itself hold. A write that went around the boundary would not be policed at all.
 *
 * ## WHAT THE DATABASE REFUSES, AND WHERE IT IS SURFACED
 *
 * The acyclicity trigger refuses a re-parent that would close a loop, and it
 * refuses it with SQLSTATE `23514` and a message naming the group and the refused
 * parent. That message is the answer to "is this move legal", so it is shown
 * rather than replaced with a generic sentence — see `authorization-failure.ts`.
 *
 * ## NO `catchError` AND NO SUCCESS-SHAPED FAILURE
 *
 * A failed write propagates to the caller as an error. Nothing here turns a
 * refusal into an empty array or a `false`, because the whole point of these two
 * surfaces is that what they show is what the database holds.
 */
@Injectable({ providedIn: 'root' })
export class AuthorizationApi {
  private readonly http = inject(HttpClient);

  /**
   * The SCOPE axis, read in one snapshot.
   *
   * `users` is in the snapshot because a membership row names a user id and a
   * screen that says "alice" rather than "3f0c…" is the difference between a
   * surface an administrator can use and one they cannot. The three reads are
   * joined because they are one question — the hierarchy and who is in it — and
   * because they share one answer when they are refused.
   */
  scope(): Observable<ScopeSnapshot> {
    return forkJoin({
      groups: this.table<GroupRow>('groups', {
        select: 'id,parent_id,name,is_system_group,created_at',
        order: 'name',
      }),
      memberships: this.table<MembershipRow>('user_groups', {
        select: 'user_id,group_id',
      }),
      users: this.table<UserRow>('users', {
        select: 'id,username,email',
        order: 'username',
      }),
    });
  }

  /**
   * The CAPABILITY axis, read in one snapshot.
   *
   * `actions` is NOT read: `permissions.action_id` IS the action's name (it is
   * the foreign key to `actions.name`), so `resource:action_id` is the whole
   * capability and a fourth table would be a second copy of the same fact.
   */
  capability(): Observable<CapabilitySnapshot> {
    return forkJoin({
      roles: this.table<RoleRow>('roles', {
        select: 'id,name,parent_id,is_system_role',
        order: 'name',
      }),
      userRoles: this.table<UserRoleRow>('user_roles', {
        select: 'user_id,role_id',
      }),
      rolePermissions: this.table<RolePermissionRow>('role_permissions', {
        select: 'role_id,permission_id',
      }),
      permissions: this.table<PermissionRow>('permissions', {
        select: 'id,resource,action_id',
      }),
    });
  }

  /**
   * `POST /groups` — a new group, optionally under a parent.
   *
   * The parent's absence is expressed by OMITTING the column, not by sending
   * `null`: `parent_id` is optional in the generated type because the column may
   * be absent, and a create that omits it takes the column's default, which is
   * no parent at all.
   */
  createGroup(name: string, parentId: string | null): Observable<void> {
    const body: GroupCreate = parentId === null ? { name } : { name, parent_id: parentId };
    return this.http.post<void>(`${POSTGREST_BASE_URL}/groups`, body);
  }

  /** `PATCH /groups` — a rename. */
  renameGroup(groupId: string, name: string): Observable<void> {
    return this.changed(
      this.http.patch<readonly GroupRow[]>(
        `${POSTGREST_BASE_URL}/groups`,
        { name } satisfies GroupCreate,
        { headers: { Prefer: 'return=representation' }, params: { id: `eq.${groupId}` } },
      ),
      'rename the group',
    );
  }

  /**
   * `PATCH /groups` — a move: the group is parented to another group.
   *
   * A move that would close a loop is REFUSED BY THE DATABASE, with `23514` and
   * a message naming the group and the refused parent. This method does not
   * pre-judge the move: the cycle rule is the database's, and a client that
   * re-implemented it would be a second copy of a rule that already exists
   * (`AGENTS.md` §2.1) and would eventually disagree with it.
   */
  moveGroup(groupId: string, parentId: string): Observable<void> {
    return this.changed(
      this.http.patch<readonly GroupRow[]>(
        `${POSTGREST_BASE_URL}/groups`,
        { parent_id: parentId } satisfies GroupMove,
        { headers: { Prefer: 'return=representation' }, params: { id: `eq.${groupId}` } },
      ),
      'move the group',
    );
  }

  /** `POST /user_groups` — a person joins a group. */
  addMember(userId: string, groupId: string): Observable<void> {
    const body: MembershipRow = { user_id: userId, group_id: groupId };
    return this.http.post<void>(`${POSTGREST_BASE_URL}/user_groups`, body);
  }

  /**
   * `DELETE /user_groups` — a person leaves a group.
   *
   * The table has a composite primary key, so the row is addressed by BOTH
   * columns. `return=representation` is what makes the refusal visible: a delete
   * that matched no row returns an empty array, and an empty array is reported
   * as "nothing was removed" rather than as a success.
   */
  removeMember(userId: string, groupId: string): Observable<void> {
    return this.changed(
      this.http.delete<readonly MembershipRow[]>(`${POSTGREST_BASE_URL}/user_groups`, {
        headers: { Prefer: 'return=representation' },
        params: { user_id: `eq.${userId}`, group_id: `eq.${groupId}` },
      }),
      'remove the member',
    );
  }

  /** `POST /user_roles` — a person holds a role. */
  assignRole(userId: string, roleId: string): Observable<void> {
    const body: UserRoleRow = { user_id: userId, role_id: roleId };
    return this.http.post<void>(`${POSTGREST_BASE_URL}/user_roles`, body);
  }

  /** `DELETE /user_roles` — a person no longer holds a role. */
  revokeRole(userId: string, roleId: string): Observable<void> {
    return this.changed(
      this.http.delete<readonly UserRoleRow[]>(`${POSTGREST_BASE_URL}/user_roles`, {
        headers: { Prefer: 'return=representation' },
        params: { user_id: `eq.${userId}`, role_id: `eq.${roleId}` },
      }),
      'revoke the role',
    );
  }

  /** A read of one table, with its columns named. */
  private table<Row extends object>(path: string, query: Record<string, string>): Observable<Row[]> {
    return this.http.get<Row[]>(`${POSTGREST_BASE_URL}/${path}`, {
      params: new HttpParams({ fromObject: query }),
    });
  }

  /**
   * A mutation that must have changed a row.
   *
   * `Prefer: return=representation` puts the affected rows in the response, and
   * an empty array means the statement matched nothing: a rename of a group that
   * no longer exists, a removal of a membership that is already gone. Reporting
   * that as a success would be a success-shaped value for work that did not
   * happen (`AGENTS.md` §2.3), so it is raised instead.
   */
  private changed(rows: Observable<readonly unknown[]>, subject: string): Observable<void> {
    return rows.pipe(
      map((affected) => {
        if (affected.length === 0) {
          throw new Error(`nothing was changed: ${subject} matched no row`);
        }
        return undefined;
      }),
    );
  }
}

