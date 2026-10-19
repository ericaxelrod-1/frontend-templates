import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import type { AdminNotificationRow } from './notification.types';

const NOTIFICATION_COLUMNS =
  'id,source,kind,severity,title,message,data,source_ref,audience,user_id,' +
  'acknowledged_at,acknowledged_by,resolved_at,resolved_by,resolution_notes,dismissed_at,' +
  'is_mock,created_at,updated_at,expires_at';

/**
 * The read for the generic notification panel.
 *
 * ## ONE TABLE, AND NO PER-SOURCE FALLBACK
 *
 * This service reads `admin_notifications` and nothing else. The page it replaces read
 * `security_alerts`, and the tempting shortcut — read the notifications, fall back to
 * the source table when there are none — is exactly the second mechanism §2.4 forbids:
 * two answers to "what does the operator see", which disagree precisely when the
 * materialiser has stopped running. An empty panel is the honest shape of a substrate
 * nothing has rendered yet, and `notifications.materialize`'s own log line is where
 * that is diagnosable.
 *
 * ## THE EXPIRY IS A SERVER-SIDE FILTER, NOT A TEMPLATE `if`
 *
 * `expires_at=gt.<now>` is the "five-year-old notifications never surface" requirement
 * expressed where it cannot be bypassed: a caller asking this table a different
 * question through PostgREST gets the same answer. Filtering in the panel would make it
 * a display rule, and a display rule is one API call away from not applying.
 *
 * The instant is sampled here, in the service, rather than in the template: `AGENTS.md`
 * §F6 forbids clock reads in a template, and a filter whose value changes between the
 * request and the render is a filter that can disagree with its own result.
 */
@Injectable({ providedIn: 'root' })
export class NotificationApi {
  private readonly http = inject(HttpClient);

  notifications(includeMock = false): Observable<readonly AdminNotificationRow[]> {
    return this.http.get<AdminNotificationRow[]>(`${POSTGREST_BASE_URL}/admin_notifications`, {
      params: new HttpParams({
        fromObject: {
          select: NOTIFICATION_COLUMNS,
          order: 'created_at.desc,id.asc',
          expires_at: `gt.${new Date().toISOString()}`,
          ...(includeMock ? {} : { is_mock: 'eq.false' }),
        },
      }),
    });
  }
}