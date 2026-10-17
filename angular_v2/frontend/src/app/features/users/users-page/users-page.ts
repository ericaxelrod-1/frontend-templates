import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Session } from '../../../core/auth/session.service';
import { NameList } from '../name-list';
import { UsersApi } from '../users-api.service';
import type { UserListRow } from '../user-list-row';

/** Shared so `computed` does not allocate a `Map` on every re-evaluation. */
const NO_NAMES: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * The Users list.
 *
 * Three independent loads, because the database grants three different things and
 * the page has to be honest about all three (see `users-api.service.ts`):
 *
 * - the `users` rows the signed-in role may read;
 * - group memberships, readable by every serving role;
 * - role assignments, readable by `app_admin` only.
 *
 * Each is its own resource so each has its own state. A `403` on the role
 * assignments does not take the user list down with it, and it is not converted
 * into an empty result: the cell says the table is not readable for this role,
 * which is what happened.
 *
 * Nothing on this page filters or counts what the caller is "meant" to see. The
 * row count is the number of rows PostgREST returned to the role the token
 * carries, and the page names that role next to it — an `app_member` sees its own
 * single row because `users_read_scope` admits `current_user = 'app_admin'` and
 * otherwise only the actor, and a page that padded that to a full list would be
 * lying.
 */
@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [DatePipe, MatCardModule, MatProgressBarModule, NameList],
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
    }

    .users tbody th {
      font: var(--mat-sys-body-medium);
    }

    .users__empty {
      color: var(--mat-sys-on-surface-variant);
    }

    .notice {
      margin: 0 0 0.75rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }
  `,
})
export class UsersPage {
  private readonly api = inject(UsersApi);
  private readonly session = inject(Session);

  private readonly usersResource = rxResource({ stream: () => this.api.users() });
  private readonly groupsResource = rxResource({ stream: () => this.api.groupNamesByUserId() });
  private readonly rolesResource = rxResource({ stream: () => this.api.roleNamesByUserId() });

  protected readonly loading = computed(() => this.usersResource.isLoading());
  protected readonly databaseRole = this.session.databaseRole;

  protected readonly rows = computed<readonly UserListRow[]>(() => {
    const users = this.usersResource.value();
    if (users === undefined) {
      return [];
    }
    const roleNames = this.rolesResource.value() ?? NO_NAMES;
    const groupNames = this.groupsResource.value() ?? NO_NAMES;
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.created_at,
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