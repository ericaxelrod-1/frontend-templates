import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CodeLabelPipe } from '../../../shared/code-label';
import { JsonbEntriesPipe } from '../jsonb-entries.pipe';
import { MockFilterBar } from '../mock-filter-bar';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { SecurityAlertRow } from '../security-telemetry.types';

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

interface AlertViewModel extends SecurityAlertRow {
  readonly urgent: boolean;
}

/**
 * `/admin/security-alerts` — operator view over `public.security_alerts`.
 *
 * Filters by `status`, `severity`, and `alert_type`. Unacknowledged and unresolved
 * (`status = 'active'`) alerts at `high` or `critical` severity are visually and
 * structurally highlighted at the top of the operator's scan, and both lifecycle
 * timestamps (`acknowledged_at`, `resolved_at` + `resolution_notes`) are shown.
 */
@Component({
  selector: 'app-security-alerts-page',
  standalone: true,
  imports: [
    CodeLabelPipe,
    DatePipe,
    JsonbEntriesPipe,
    MatCardModule,
    MatProgressBarModule,
    MockFilterBar,
  ],
  templateUrl: './security-alerts-page.html',
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
export class SecurityAlertsPage {
  private readonly api = inject(SecurityTelemetryApi);

  protected readonly includeMock = signal(false);
  protected readonly statusFilter = signal('all');
  protected readonly severityFilter = signal('all');
  protected readonly typeFilter = signal('all');

  protected readonly severityLabels = SEVERITY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;

  private readonly alertsResource = rxResource({
    params: () => this.includeMock(),
    stream: ({ params }) => this.api.securityAlerts(params),
  });

  protected readonly loading = computed(() => this.alertsResource.isLoading());

  protected readonly allRows = computed<readonly AlertViewModel[]>(() => {
    const rows = this.alertsResource.hasValue() ? this.alertsResource.value() : undefined;
    if (rows === undefined) {
      return [];
    }
    return rows.map((row) => ({
      ...row,
      urgent: isUrgentAlert(row),
    }));
  });

  protected readonly alertTypes = computed<readonly string[]>(() => {
    const seen = new Set<string>();
    for (const row of this.allRows()) {
      seen.add(row.alert_type);
    }
    return Array.from(seen).sort();
  });

  protected readonly filteredRows = computed<readonly AlertViewModel[]>(() => {
    const status = this.statusFilter();
    const severity = this.severityFilter();
    const alertType = this.typeFilter();
    return this.allRows().filter((row) => {
      const matchesStatus = status === 'all' || row.status === status;
      const matchesSeverity = severity === 'all' || row.severity === severity;
      const matchesType = alertType === 'all' || row.alert_type === alertType;
      return matchesStatus && matchesSeverity && matchesType;
    });
  });

  protected readonly urgentCount = computed(
    () => this.filteredRows().filter((row) => row.urgent).length,
  );

  protected readonly summary = computed(() => {
    const shown = this.filteredRows().length;
    const urgent = this.urgentCount();
    const base = `${shown} ${shown === 1 ? 'alert' : 'alerts'} shown`;
    return urgent > 0 ? `${base} (${urgent} unacknowledged high/critical).` : `${base}.`;
  });

  protected readonly failureReason = computed(() => {
    const error = this.alertsResource.error();
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

function isUrgentAlert(row: SecurityAlertRow): boolean {
  const highOrCritical = row.severity === 'critical' || row.severity === 'high';
  return row.status === 'active' && highOrCritical;
}
