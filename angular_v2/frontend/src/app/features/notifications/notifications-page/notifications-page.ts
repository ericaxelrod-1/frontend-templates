import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CodeLabelPipe } from '../../../shared/code-label';
import { JsonbEntriesPipe } from '../../../shared/jsonb-entries.pipe';
import { MockFilterBar } from '../../../shared/mock-filter-bar';
import { NotificationApi } from '../notification-api.service';
import type { AdminNotificationRow, NotificationStatus } from '../notification.types';
import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_STATUSES,
  canonicalIpOf,
  isUrgentNotification,
  notificationStatus,
} from '../notification.types';

const SEVERITY_LABELS: Readonly<Record<string, string>> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'Active (unacknowledged)',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

/**
 * What the template renders for one notification.
 *
 * Derived in a `computed()` rather than in the template, because `AGENTS.md` §F5
 * forbids a method call in a binding: `notificationStatus(row)` in the template
 * re-evaluates on every change-detection pass, and the derived label is on every row.
 */
interface NotificationViewModel {
  readonly row: AdminNotificationRow;
  readonly status: NotificationStatus;
  readonly canonicalIp: string | undefined;
  readonly urgent: boolean;
}

/**
 * `/admin/security-alerts` — the operator panel over `public.admin_notifications`.
 *
 * ## THE GENERIC SURFACE, AND WHAT "SAME DATA" COSTS
 *
 * This page replaces one that read `public.security_alerts` through the generated
 * PostgREST client. It now reads `admin_notifications`, which is a substrate written by
 * `notifications.materialize` rather than by whatever writes the source table — so the
 * rendered set is the same set **once the materialiser has run**, and empty until it
 * does. That is the intended direction (§B1: PostgREST serves the table, and the
 * materialiser owns what is in it) and it is the one behavioural difference in this
 * refactor; it is recorded rather than hidden behind a fallback read, because a fallback
 * is a second mechanism for "what the operator sees" that agrees with the first exactly
 * when nothing is broken.
 *
 * Every filter and every rendered field the previous page had is still here:
 *
 *   status filter   the same four values, now DERIVED from three timestamps rather than
 *                   read from a `status` column — see `notification.types.ts` for why the
 *                   column is gone and what replaces it.
 *   severity filter the same four values.
 *   type filter     the same dynamic list, now built from `kind` — which is the source
 *                   row's own `alert_type`, copied by the materialiser, so the list
 *                   holds exactly the values it held before.
 *   mock filter     the same bar, over the same `is_mock` column.
 *   rendering       title, message, severity, status, type, `created_at`, `source`,
 *                   canonical IP, `acknowledged_at`, `resolved_at`, `resolution_notes`
 *                   and the jsonb evidence list — every one of them, from the generic
 *                   table. `pattern_id`, `ip`, `ip_subnet` and `alert_data` are read out
 *                   of `data` rather than off their own columns, which is what lets one
 *                   panel serve a source with none of them.
 *
 * The one thing ADDED is `dismissed_at`, because the generic table's own lifecycle has a
 * dismissal and a panel that cannot show it would make the dismissal invisible.
 */
@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [
    CodeLabelPipe,
    DatePipe,
    JsonbEntriesPipe,
    MatCardModule,
    MatProgressBarModule,
    MockFilterBar,
  ],
  templateUrl: './notifications-page.html',
  styles: `
    :host {
      display: block;
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1rem;
      margin-bottom: 1rem;
      align-items: flex-end;
    }

    .filters__field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    .filters__select {
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 0.35rem;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
    }

    .alerts {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .alert-card {
      padding: 0.85rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
      background: var(--mat-sys-surface);
    }

    .alert-card--urgent {
      border-left: 4px solid var(--mat-sys-error);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .alert-card__header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }

    .alert-card__title {
      font: var(--mat-sys-title-small);
      margin: 0;
    }

    .alert-card__badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .badge {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-label-small);
    }

    .badge--urgent {
      background: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
      border-color: var(--mat-sys-error);
      font-weight: 600;
    }

    .badge--mock {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }

    .alert-card__desc {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-body-medium);
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
      gap: 0.5rem 1rem;
      margin: 0;
      font: var(--mat-sys-body-small);
    }

    .meta-grid dt {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .meta-grid dd {
      margin: 0;
    }

    .kv-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      margin: 0.5rem 0 0;
      padding-top: 0.5rem;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-body-small);
    }

    .notice--error {
      color: var(--mat-sys-error);
    }

    .empty {
      color: var(--mat-sys-on-surface-variant);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  `,
})
export class NotificationsPage {
  private readonly api = inject(NotificationApi);

  protected readonly includeMock = signal(false);
  protected readonly statusFilter = signal('all');
  protected readonly severityFilter = signal('all');
  protected readonly typeFilter = signal('all');

  protected readonly severityLabels = SEVERITY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;

  /**
   * The four severities, from the table's own CHECK rather than a list written here
   * twice — `notification.types.ts` is the single copy, for the same reason §2.4.
   */
  protected readonly severities = NOTIFICATION_SEVERITIES;
  protected readonly statuses = NOTIFICATION_STATUSES;

  private readonly notificationsResource = rxResource({
    params: () => this.includeMock(),
    stream: ({ params }) => this.api.notifications(params),
  });

  protected readonly loading = computed(() => this.notificationsResource.isLoading());

  protected readonly allRows = computed<readonly NotificationViewModel[]>(() => {
    const rows = this.notificationsResource.hasValue() ? this.notificationsResource.value() : undefined;
    if (rows === undefined) {
      return [];
    }
    return rows.map((row) => ({
      row,
      status: notificationStatus(row),
      canonicalIp: canonicalIpOf(row),
      urgent: isUrgentNotification(row),
    }));
  });

  protected readonly kinds = computed<readonly string[]>(() => {
    const seen = new Set<string>();
    for (const entry of this.allRows()) {
      seen.add(entry.row.kind);
    }
    return Array.from(seen).sort();
  });

  protected readonly filteredRows = computed<readonly NotificationViewModel[]>(() => {
    const status = this.statusFilter();
    const severity = this.severityFilter();
    const kind = this.typeFilter();
    return this.allRows().filter((entry) => {
      const matchesStatus = status === 'all' || entry.status === status;
      const matchesSeverity = severity === 'all' || entry.row.severity === severity;
      const matchesKind = kind === 'all' || entry.row.kind === kind;
      return matchesStatus && matchesSeverity && matchesKind;
    });
  });

  protected readonly urgentCount = computed(
    () => this.filteredRows().filter((entry) => entry.urgent).length,
  );

  protected readonly summary = computed(() => {
    const shown = this.filteredRows().length;
    const urgent = this.urgentCount();
    const base = `${String(shown)} ${shown === 1 ? 'notification' : 'notifications'} shown`;
    return urgent > 0 ? `${base} (${String(urgent)} unacknowledged high/critical).` : `${base}.`;
  });

  protected readonly failureReason = computed(() => {
    const error = this.notificationsResource.error();
    if (error === undefined) {
      return null;
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'The database refused this read for the signed-in role (403).';
    }
    return error instanceof HttpErrorResponse
      ? `The request failed: HTTP ${error.status}`
      : 'The request could not be completed.';
  });

  protected setIncludeMock(value: boolean): void {
    this.includeMock.set(value);
  }

  protected onStatusChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
  }

  protected onSeverityChange(event: Event): void {
    this.severityFilter.set((event.target as HTMLSelectElement).value);
  }

  protected onTypeChange(event: Event): void {
    this.typeFilter.set((event.target as HTMLSelectElement).value);
  }
}