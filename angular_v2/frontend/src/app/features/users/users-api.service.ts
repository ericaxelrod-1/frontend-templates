import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { forkJoin, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import type { components } from '../../api/schema';

/*
 * Row shapes are `Pick`s of the generated `components['schemas']`, so a column
 * renamed in the database fails `npm run generate:client` + typecheck here rather
 * than arriving as `undefined` in a table cell. They are declared here and not
 * exported: the only consumer is this service, and they exist to describe a
 * request this service makes — a narrower contract than the whole table.
 */
type UsersRow = Pick<components['schemas']['users'], 'id' | 'username' | 'email' | 'created_at'>;
type UserGroupsRow = Pick<components['schemas']['user_groups'], 'user_id' | 'group_id'>;
type GroupsRow = Pick<components['schemas']['groups'], 'id' | 'name'>;
type UserRolesRow = Pick<components['schemas']['user_roles'], 'user_id' | 'role_id'>;
type RolesRow = Pick<components['schemas']['roles'], 'id' | 'name'>;

/**
 * The columns a list of users actually needs, and — the reason it is written out
 * rather than `select=*` — the columns `app_member` is granted on `users`.
 *
 * `0001_rls_foundation.sql` and `0012_user_geo.sql` grant `app_member` a
 * COLUMN-level `SELECT` on `users`, and a column-restricted role cannot use
 * `select=*` at all: the request would be refused. Naming the four columns is what
 * makes one endpoint serve both serving roles.
 *
 * `password_hash` is absent from every request in this file by the same rule.
 * `app_admin` holds table-level `SELECT` on `users`, so `*` would have handed it
 * every hash in the table to render a list of names.
 */
const USER_COLUMNS = 'id,username,email,created_at';

/** Group names per user id. Readable by every serving role. */
export type GroupNamesByUserId = ReadonlyMap<string, readonly string[]>;

/** Role names per user id. Admin-only at the table level — see the method. */
export type RoleNamesByUserId = ReadonlyMap<string, readonly string[]>;

/**
 * Reads for the Users page. This is the only file that talks to PostgREST.
 *
 * The three methods are three loads rather than one because the grants are not
 * uniform, and that is the point of the page rather than a defect in it:
 *
 * - `users` — every serving role may read it; `app_member` sees only its own row
 *   (`users_read_scope`, which admits `current_user = 'app_admin'` and otherwise
 *   only the actor), so a member's list legitimately has one entry.
 * - `user_groups` + `groups` — granted to every serving role, and the policies
 *   limit a member to their own membership rows and their own subtree.
 * - `user_roles` + `roles` — the capability axis is **admin-only at the table
 *   level**; `app_member` holds no `SELECT` on either (AGENTS.md §B2, and
 *   `0001_rls_foundation.sql`: "THE CAPABILITY AXIS IS ADMIN-ONLY AT THE TABLE
 *   LEVEL"). A member gets `403`, which is a correct answer about a healthy
 *   session. It is surfaced, never swallowed — see `users-page.ts`.
 *
 * Nothing here filters, and nothing here can widen: the response is whatever the
 * database returns to the role the token carries.
 */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);

  users(): Observable<readonly UsersRow[]> {
    return this.table<UsersRow>('users', { select: USER_COLUMNS, order: 'created_at' });
  }

  groupNamesByUserId(): Observable<GroupNamesByUserId> {
    return forkJoin({
      memberships: this.table<UserGroupsRow>('user_groups', { select: 'user_id,group_id' }),
      groups: this.table<GroupsRow>('groups', { select: 'id,name' }),
    }).pipe(
      map(({ memberships, groups }) =>
        namesByUserId(
          memberships.map((m) => ({ userId: m.user_id, targetId: m.group_id })),
          groups,
        ),
      ),
    );
  }

  roleNamesByUserId(): Observable<RoleNamesByUserId> {
    return forkJoin({
      assignments: this.table<UserRolesRow>('user_roles', { select: 'user_id,role_id' }),
      roles: this.table<RolesRow>('roles', { select: 'id,name' }),
    }).pipe(
      map(({ assignments, roles }) =>
        namesByUserId(
          assignments.map((a) => ({ userId: a.user_id, targetId: a.role_id })),
          roles,
        ),
      ),
    );
  }

  private table<Row extends object>(path: string, query: Record<string, string>): Observable<Row[]> {
    return this.http.get<Row[]>(`${POSTGREST_BASE_URL}/${path}`, {
      params: new HttpParams({ fromObject: query }),
    });
  }
}

/** One row of a link table, reduced to the two ids that matter. */
interface UserLink {
  readonly userId: string;
  readonly targetId: string;
}

/**
 * Joins a link table to the table it points at, keyed by user.
 *
 * A link whose target is not in the second list — a membership whose group the
 * caller cannot read, which is exactly what a member's own subtree produces —
 * contributes nothing rather than a dangling id. Rendering `undefined` as a name
 * would be worse than showing nothing, and the row count the database returned is
 * already on screen next to it.
 */
function namesByUserId(
  links: readonly UserLink[],
  targets: readonly { readonly id: string; readonly name: string }[]
): GroupNamesByUserId {
  const namesById = new Map(targets.map((target) => [target.id, target.name]));
  const result = new Map<string, string[]>();
  for (const link of links) {
    const name = namesById.get(link.targetId);
    if (name === undefined) {
      continue;
    }
    const existing = result.get(link.userId);
    if (existing === undefined) {
      result.set(link.userId, [name]);
    } else if (!existing.includes(name)) {
      existing.push(name);
    }
  }
  return result;
}