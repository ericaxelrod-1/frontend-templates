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
type UsersTable = components['schemas']['users'];
type UserGroupsRow = Pick<components['schemas']['user_groups'], 'user_id' | 'group_id'>;
type GroupsRow = Pick<components['schemas']['groups'], 'id' | 'name'>;
type UserRolesRow = Pick<components['schemas']['user_roles'], 'user_id' | 'role_id'>;
type RolesRow = Pick<components['schemas']['roles'], 'id' | 'name'>;

/**
 * A `users` row as this service returns it.
 *
 * Exported because it is the service's public return type — a consumer that cannot
 * name it cannot type a fixture for it, and `users-page.spec.ts` needs one. It is
 * still narrower than the table: the link and vocabulary rows above stay private,
 * because nothing outside this file needs them.
 *
 * `Exclude<keyof UsersTable, 'password_hash'>` is the whole safety argument in one
 * clause: `password_hash` is a CREDENTIAL artifact, not data about a user, so this
 * Pick cannot include it even by accident — dropping that clause is a type error at
 * every use of the row, not a review question. And the two column strings below are
 * hand-written, so `users-api.service.spec.ts` asserts them literally rather than
 * trusting the type to have been noticed.
 *
 * Every admin-only column is OPTIONAL in the generated type, so a response to the
 * MEMBER column set — which has none of those keys — satisfies this shape without a
 * cast. The type says those columns MAY be present, not that they are: the page
 * decides what to render from the scope it sent, never from whether a key is there.
 */
type UsersRow = Pick<UsersTable, Exclude<keyof UsersTable, 'password_hash'>>;

export type { UsersRow };

/**
 * Which columns a `users` read may name. Not a preference — it is what makes the
 * request legal.
 *
 * `app_member` holds a COLUMN-level `SELECT` on `users`
 * (`0023_user_profile_and_disable.sql`), and a column-restricted role cannot use
 * `select=*` at all: PostgREST refuses the request outright. Naming a column the
 * role does not hold fails the WHOLE request with `403` — it does not quietly
 * omit that one key — which is why the member page must not so much as NAME an
 * admin-only column.
 */
export type UsersColumnScope = 'member' | 'admin';

/**
 * The member grant, in the order `0023_user_profile_and_disable.sql` grants it:
 *
 *     (id, username, email, created_at,
 *      country_code, region_code, city, geo_source, geo_accuracy_km, geo_updated_at,
 *      first_name, last_name)
 *
 * Every serving role holds this set, so naming it is always legal and it is the
 * right request whenever the caller's role is not known to be `app_admin`.
 */
const MEMBER_USER_COLUMNS =
  'id,username,email,created_at,country_code,region_code,city,geo_source,geo_accuracy_km,geo_updated_at,first_name,last_name';

/**
 * Every column `users` has EXCEPT `password_hash`.
 *
 * `app_admin` holds table-level `SELECT` on `users`, so it may name anything at
 * all — and `*` would be the shorter way to say the same thing. It is spelled out
 * for the opposite reason: `select=*` under a table-level grant hands back every
 * hash in the table to render a list of names, and a list of column names is a
 * thing a reviewer can read and a test can assert. `password_hash` is the one
 * column absent from both strings in this file, and it is absent because it is a
 * credential artifact: it is in no page's column list, in no `SELECT`, and in no
 * query the browser can make.
 */
const ADMIN_USER_COLUMNS =
  'id,username,email,created_at,first_name,last_name,last_login_at,last_activity_at,' +
  'email_verified_at,deleted_at,deletion_reason,email_anonymized,' +
  'country_code,region_code,city,geo_source,geo_accuracy_km,geo_updated_at,' +
  'disabled_at,disabled_by,disabled_reason,disabled_until';

/** Group names per user id. Readable by every serving role. */
export type GroupNamesByUserId = ReadonlyMap<string, readonly string[]>;

/** Role names per user id. Admin-only at the table level — see the method. */
export type RoleNamesByUserId = ReadonlyMap<string, readonly string[]>;

/**
 * The column scope for a database role, defaulting to the narrowest set.
 *
 * The role comes from `GET /auth/me` and is a DB role name, not a capability
 * (AGENTS.md §B5) — so this is a UX decision about which columns to ASK for, never
 * an authorization one. `app_admin` happens to hold the wide grant; any other role,
 * and any role this build has never heard of, gets the twelve columns every serving
 * role holds. Getting it wrong cannot widen anything: if the token claims
 * `app_admin` without the grant behind it, PostgREST answers `403` and the page
 * reports that rather than showing blanks.
 */
export function columnScopeFor(databaseRole: string | null): UsersColumnScope {
  return databaseRole === 'app_admin' ? 'admin' : 'member';
}

/**
 * Reads for the Users page. This is the only file that talks to PostgREST for
 * `users`.
 *
 * The three association reads are three separate loads rather than one because the
 * grants are not uniform, and that is the point of the page rather than a defect in
 * it:
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

  /**
   * The `users` rows this role may read, with the columns it may name.
   *
   * `order=created_at` is the one thing this method does impose, and it is
   * ordering rather than filtering: which rows come back is the policy's decision,
   * and the page says so next to the count.
   */
  users(scope: UsersColumnScope): Observable<readonly UsersRow[]> {
    return this.table<UsersRow>('users', {
      select: scope === 'admin' ? ADMIN_USER_COLUMNS : MEMBER_USER_COLUMNS,
      order: 'created_at',
    });
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
  targets: readonly { readonly id: string; readonly name: string }[],
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