import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Session } from '../../../core/auth/session.service';
import { GeoPlace } from '../../../shared/geo-place';
import { NameList } from '../name-list';
import { OptionalStamp } from '../optional-stamp';
import { UserAccountState } from '../user-account-state';
import { columnScopeFor, UsersApi } from '../users-api.service';
import type { UserListRow } from '../user-list-row';

/** Shared so `computed` does not allocate a `Map` on every re-evaluation. */
const NO_NAMES: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * The Users page: every `users` column that means something to an operator, for
 * every account the signed-in role may read.
 *
 * ## Three independent loads, because the grants are three different things
 *
 * The `users` rows, group memberships and role assignments are separate reads with
 * separate grants (see `users-api.service.ts`). Each is its own resource so each
 * has its own state: a `403` on the role assignments does not take the user list
 * down with it, and it is not converted into an empty result — the cell says the
 * table is not readable for this role, which is what happened.
 *
 * ## The page asks for the columns the caller's grant can name
 *
 * `UsersApi.users(scope)` takes its column list from `columnScopeFor(role)`, and
 * the resource is keyed on that scope so a signed-in administrator's first read
 * with the twelve-column set is replaced by the full one as soon as `/auth/me`
 * resolves. It matters that this is decided BEFORE the request: a column-restricted
 * role cannot use `select=*`, and naming one column it does not hold fails the
 * whole read with `403` rather than omitting that key. So for a member this page
 * does not ask for `last_login_at`, `email_verified_at`, `deleted_at` or
 * `disabled_*` at all, and the columns show "not readable for this role" instead.
 *
 * That is a UX decision about what to ASK for and never an authorization one. The
 * database is the authority: a token claiming `app_admin` without the grant behind
 * it gets `403` here and the page reports it rather than rendering blanks.
 *
 * ## Nothing on this page filters or counts what the caller is "meant" to see
 *
 * The row count is the number of rows PostgREST returned to the role the token
 * carries, and the page names that role next to it — an `app_member` sees its own
 * single row because `users_read_scope` admits `current_user = 'app_admin'` and
 * otherwise only the actor, and a page that padded that to a full list would be
 * lying.
 *
 * ## `last_login_at` and `last_activity_at` are separate columns on purpose
 *
 * One is when the account last passed a CREDENTIAL check, the other is when the
 * application last OBSERVED any activity at all, and NULL means something different
 * in each. They are labelled distinctly and never collapsed into a "last seen":
 * collapsing them would make "never signed in" and "never observed" the same
 * sentence, and would let the second stand in for the first.
 *
 * ## `email_verified_at` is a timestamp and is rendered as one
 *
 * It is not turned into a "verified" badge. The column answers WHEN the address
 * was verified, and it says nothing about the address since — a boolean built on it
 * would claim to know more than the database records.
 */
@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [
    GeoPlace,
    MatCardModule,
    MatProgressBarModule,
    NameList,
    OptionalStamp,
    UserAccountState,
  ],
  templateUrl: './users-page.html',
  styles: `
    :host {
      display: block;
    }

    /*
     * The caption is centered by the user-agent stylesheet while everything else
     * in the card is left-aligned, which reads as a mistake. Align it with the
     * table it describes.
     */
    .users__caption {
      caption-side: top;
      text-align: left;
      padding-bottom: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Eleven columns of audit data do not fit a laptop; the card scrolls. */
    .users__scroll {
      overflow-x: auto;
    }

    .users {
      width: 100%;
      border-collapse: collapse;
    }

    .users th,
    .users td {
      text-align: left;
      padding: 0.5rem 0.75rem 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }

    .users thead th {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    .users tbody th {
      font: var(--mat-sys-body-medium);
    }

    .users__id {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .users__name {
      display: flex;
      gap: 0.35rem;
    }

    .users__absent,
    .users__empty {
      color: var(--mat-sys-on-surface-variant);
    }

    .notice {
      margin: 0 0 0.75rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  `,
})
export class UsersPage {
  private readonly api = inject(UsersApi);
  private readonly session = inject(Session);

  /**
   * `null` until `/auth/me` resolves, which is the narrowest possible answer: a
   * member's own page renders from the first request and nothing has to be
   * re-fetched when the role turns out to be `app_admin`.
   */
  protected readonly columnScope = computed(() => columnScopeFor(this.session.databaseRole()));

  private readonly usersResource = rxResource({
    params: () => this.columnScope(),
    stream: ({ params }) => this.api.users(params),
  });

  private readonly groupsResource = rxResource({ stream: () => this.api.groupNamesByUserId() });
  private readonly rolesResource = rxResource({ stream: () => this.api.roleNamesByUserId() });

  protected readonly loading = computed(() => this.usersResource.isLoading());
  protected readonly databaseRole = this.session.databaseRole;

  /**
   * Whether the twelve admin-only columns were requested. This is the source of
   * truth for every "not readable for this role" cell — NOT the presence or absence
   * of a key on the row — because "this account was never disabled" and "these
   * columns were not read" must not render the same thing.
   */
  protected readonly adminColumnsReadable = computed(() => this.columnScope() === 'admin');

  protected readonly rows = computed<readonly UserListRow[]>(() => {
    // `hasValue()` first, not `value() !== undefined`: reading `.value()` on a
    // resource that is in an ERROR state THROWS rather than returning undefined, and
    // this computed runs on the page precisely when a read has failed. The empty
    // list below is paired with the failure notice, so it never renders alone.
    const users = this.usersResource.hasValue() ? this.usersResource.value() : undefined;
    if (users === undefined) {
      return [];
    }
    // The same guard on both association reads: a `403` on `user_roles` must not
    // take the user list down with it, and it must not take the page down either.
    const roleNames = this.rolesResource.hasValue() ? this.rolesResource.value() : NO_NAMES;
    const groupNames = this.groupsResource.hasValue() ? this.groupsResource.value() : NO_NAMES;
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.created_at,
      firstName: nullable(user.first_name),
      lastName: nullable(user.last_name),
      lastLoginAt: nullable(user.last_login_at),
      lastActivityAt: nullable(user.last_activity_at),
      emailVerifiedAt: nullable(user.email_verified_at),
      deletedAt: nullable(user.deleted_at),
      deletionReason: nullable(user.deletion_reason),
      emailAnonymized: nullable(user.email_anonymized),
      countryCode: nullable(user.country_code),
      regionCode: nullable(user.region_code),
      city: nullable(user.city),
      geoSource: nullable(user.geo_source),
      geoAccuracyKm: nullable(user.geo_accuracy_km),
      geoUpdatedAt: nullable(user.geo_updated_at),
      disabledAt: nullable(user.disabled_at),
      disabledBy: nullable(user.disabled_by),
      disabledReason: nullable(user.disabled_reason),
      disabledUntil: nullable(user.disabled_until),
      roleNames: roleNames.get(user.id) ?? [],
      groupNames: groupNames.get(user.id) ?? [],
    }));
  });

  protected readonly rolesBlocked = computed(() => isForbidden(this.rolesResource.error()));
  protected readonly groupsBlocked = computed(() => isForbidden(this.groupsResource.error()));

  protected readonly summary = computed(() => {
    const count = this.rows().length;
    const role = this.databaseRole() ?? 'a role the database did not name';
    return `${count} ${count === 1 ? 'user' : 'users'} returned to ${role}.`;
  });

  protected readonly failureReason = computed(() => {
    const error = this.usersResource.error();
    if (error === undefined) {
      return null;
    }
    if (isForbidden(error)) {
      return 'The database refused this read for the signed-in role (403).';
    }
    return `The request failed: ${statusOf(error)}`;
  });
}

/**
 * `undefined` is the wire's word for "the column was not read"; `null` is this
 * page's word for "the column was read and the database has no value". Normalising
 * once here keeps every template and every child component from having to know the
 * difference, and keeps it out of `UserListRow`'s contract.
 */
function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

/**
 * `403` is PostgREST's answer for a principal that is authenticated but not
 * granted the table, and it is the expected answer here for a member reading
 * `user_roles`. It is also the only status treated as a refusal of the *role*
 * rather than a broken request, so it is worth naming.
 */
function isForbidden(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 403;
}

function statusOf(error: unknown): string {
  return error instanceof HttpErrorResponse
    ? `HTTP ${error.status}`
    : 'the request could not be completed';
}