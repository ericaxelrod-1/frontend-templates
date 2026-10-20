import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import type { DisabledUserRow } from './blocked.types';

const DISABLED_USER_COLUMNS =
  'id,username,email,created_at,first_name,last_name,disabled_at,disabled_by,disabled_reason,disabled_until';

/**
 * PostgREST reads and updates for disabled and suspended user accounts.
 *
 * ## PERMISSION AND GRANTS
 *
 * `app_admin` holds table-level `SELECT` and `UPDATE` on `public.users` (0008, 0023).
 * `app_member` holds only a narrow column list excluding `disabled_*` columns.
 * When called by a non-administrator, PostgREST returns `403 Forbidden`, which is
 * surfaced to the user as "not readable for this role" (AGENTS.md §F7).
 */
@Injectable({ providedIn: 'root' })
export class BlockedApi {
  private readonly http = inject(HttpClient);

  /**
   * Fetches all user rows where `disabled_at IS NOT NULL`.
   */
  blockedUsers(): Observable<readonly DisabledUserRow[]> {
    return this.http.get<DisabledUserRow[]>(`${POSTGREST_BASE_URL}/users`, {
      params: new HttpParams({
        fromObject: {
          select: DISABLED_USER_COLUMNS,
          disabled_at: 'not.is.null',
          order: 'disabled_at.desc',
        },
      }),
    });
  }

  /**
   * Re-enables a disabled account by setting all four `disabled_*` columns to `null`.
   */
  reEnable(userId: string): Observable<void> {
    return this.http.patch<void>(
      `${POSTGREST_BASE_URL}/users`,
      {
        disabled_at: null,
        disabled_by: null,
        disabled_reason: null,
        disabled_until: null,
      },
      {
        params: new HttpParams({
          fromObject: {
            id: `eq.${userId}`,
          },
        }),
      },
    );
  }
}
