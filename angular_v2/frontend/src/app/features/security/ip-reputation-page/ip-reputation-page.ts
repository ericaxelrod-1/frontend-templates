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
import type { IpReputationRow } from '../security-telemetry.types';

const STATUS_LABELS: Readonly<Record<string, string>> = {
  good: 'Good',
  suspicious: 'Suspicious',
  bad: 'Bad',
};

interface IpReputationViewModel extends IpReputationRow {
  readonly showRawIp: boolean;
}

/**
 * `/admin/ip-reputation` — operator view over `public.ip_reputation`.
 *
 * Canonical `ip_normalized` is the identity (`0022_security_telemetry.sql`); raw
 * `ip` is shown only when it differs from `ip_normalized`. Renders `status`
 * (`good`/`suspicious`/`bad`), `reputation_score`, `failed_attempts`, and block
 * state (`is_blocked`, `blocked_until`, `block_reason`).
 */
@Component({
  selector: 'app-ip-reputation-page',
  standalone: true,
  imports: [
    CodeLabelPipe,
    DatePipe,
    JsonbEntriesPipe,
    MatCardModule,
    MatProgressBarModule,
    MockFilterBar,
  ],
  templateUrl: './ip-reputation-page.html',
  styles: `
    :host {
      display: block;
    }

    .table-scroll {
      overflow-x: auto;
    }

    .rep-table {
      width: 100%;
      border-collapse: collapse;
    }

    .rep-table th,
    .rep-table td {
      text-align: left;
      padding: 0.5rem 0.65rem 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }

    .rep-table thead th {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    .sub {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .badge {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-label-small);
    }

    .badge--bad {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-weight: 600;
    }

    .badge--mock {
      display: inline-block;
      margin-top: 0.2rem;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
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
export class IpReputationPage {
  private readonly api = inject(SecurityTelemetryApi);

  protected readonly includeMock = signal(false);
  protected readonly statusLabels = STATUS_LABELS;

  private readonly reputationResource = rxResource({
    params: () => this.includeMock(),
    stream: ({ params }) => this.api.ipReputation(params),
  });

  protected readonly loading = computed(() => this.reputationResource.isLoading());

  protected readonly rows = computed<readonly IpReputationViewModel[]>(() => {
    const raw = this.reputationResource.hasValue() ? this.reputationResource.value() : undefined;
    if (raw === undefined) {
      return [];
    }
    return raw.map((row) => ({
      ...row,
      showRawIp: row.ip !== row.ip_normalized,
    }));
  });

  protected readonly summary = computed(() => {
    const count = this.rows().length;
    const blocked = this.rows().filter((r) => r.is_blocked).length;
    const base = `${count} ${count === 1 ? 'address' : 'addresses'} returned`;
    return blocked > 0 ? `${base} (${blocked} currently blocked).` : `${base}.`;
  });

  protected readonly failureReason = computed(() => {
    const error = this.reputationResource.error();
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
}
