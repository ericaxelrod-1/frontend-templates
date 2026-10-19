import type { components } from '../../api/schema';

/**
 * One row of `public.admin_notifications`, the GENERIC panel's substrate.
 *
 * Every field is a `Pick` of the generated schema rather than a hand-written interface:
 * `AGENTS.md` §B4 forbids hand-writing a response shape, and a column rename that this
 * file had anticipated would be a compile error here rather than at PostgREST.
 *
 * ## WHAT THE GENERIC TABLE DOES NOT CARRY, AND WHERE IT WENT
 *
 * The page this replaces read `public.security_alerts` directly, so it also read
 * `status`, `pattern_id`, `ip`, `ip_normalized`, `ip_subnet`, `alert_data` and
 * `source`. Two of those moved and two did not, and the difference is the whole of the
 * refactor:
 *
 *   * `source` is here — the discriminator half that says which data source produced
 *     this row, which is what makes one panel serve any source.
 *   * `kind` replaces `alert_type`: the discriminator half that says which kind of
 *     thing it is, and it is what the "Notification type" filter still reads.
 *   * `pattern_id`, `ip`, `ip_normalized`, `ip_subnet` and `alert_data` are NOT
 *     columns here — they are keys inside `data`. A generic table with an IP-shaped
 *     set of columns is a `security_alerts` table with extra steps; `data` is where a
 *     source's own payload belongs, and `JsonbEntriesPipe` renders it either way.
 *   * `status` is NOT a column, and this file derives it. See
 *     {@link notificationStatus}.
 */
export type AdminNotificationRow = Pick<
  components['schemas']['admin_notifications'],
  | 'id'
  | 'source'
  | 'kind'
  | 'severity'
  | 'title'
  | 'message'
  | 'data'
  | 'source_ref'
  | 'audience'
  | 'user_id'
  | 'acknowledged_at'
  | 'acknowledged_by'
  | 'resolved_at'
  | 'resolved_by'
  | 'resolution_notes'
  | 'dismissed_at'
  | 'is_mock'
  | 'created_at'
  | 'updated_at'
  | 'expires_at'
>;

/**
 * The four states the panel filters by — the same four `security_alerts.status`
 * carried, derived rather than stored.
 *
 * ## Why there is no `status` column and this is not a loss
 *
 * A stored status repeats what three timestamps already say, and two representations of
 * one fact drift the first time somebody edits one of them: a row claiming `active`
 * while carrying a `dismissed_at` is exactly the shape a resurrected notification has.
 * `0027` says this at length; the short form is that the timestamps are the record and
 * the status is a reading of it.
 *
 * The precedence below is total and ordered, and it is the same precedence the stored
 * column had: a dismissed notification is dismissed even if it was also acknowledged,
 * and a resolved one is resolved even if it was never acknowledged — which
 * `security_alerts` explicitly allowed by NOT demanding an acknowledgement stamp for a
 * resolution.
 */
export type NotificationStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

export function notificationStatus(row: AdminNotificationRow): NotificationStatus {
  if (row.dismissed_at !== undefined) {
    return 'dismissed';
  }
  if (row.resolved_at !== undefined) {
    return 'resolved';
  }
  if (row.acknowledged_at !== undefined) {
    return 'acknowledged';
  }
  return 'active';
}

/** Every severity the table's CHECK allows, in the order a reader scans them. */
export const NOTIFICATION_SEVERITIES: readonly string[] = ['critical', 'high', 'medium', 'low'];

/** Every status the derived lifecycle can produce, in the order a reader scans them. */
export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  'active',
  'acknowledged',
  'resolved',
  'dismissed',
];

/** True for the unacknowledged high/critical rows an operator scans for first. */
export function isUrgentNotification(row: AdminNotificationRow): boolean {
  return notificationStatus(row) === 'active' && (row.severity === 'critical' || row.severity === 'high');
}

/**
 * A source's canonical host, out of `data`.
 *
 * The one key the panel still names explicitly, because it is the field the page it
 * replaces gave its own labelled cell — and "do not lose a column" means the Canonical
 * IP line stays. Read defensively: `data` is whatever the source put there, so a source
 * that does not carry one renders "not recorded" rather than nothing.
 */
export function canonicalIpOf(row: AdminNotificationRow): string | undefined {
  const value = (row.data as { readonly ip_normalized?: unknown } | null)?.ip_normalized;
  return typeof value === 'string' && value !== '' ? value : undefined;
}