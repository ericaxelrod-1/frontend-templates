import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CodeLabelPipe } from '../../../shared/code-label';
import { MockFilterBar } from '../mock-filter-bar';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { LoginAttemptWithMock } from '../security-telemetry.types';

const ATTEMPT_KIND_LABELS: Readonly<Record<string, string>> = {
  login: 'Credential check (login)',
  token_request: 'Reset/verification token (token_request)',
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
};

interface AttemptViewModel extends LoginAttemptWithMock {
  readonly showRawIp: boolean;
}

/**
 * `/admin/login-attempts` — raw attempt log over `public.login_attempts` in full:
 * who is trying to get in, from which canonical host (`ip_normalized`) and rate-limit
 * bucket (`ip_subnet`), under which budget (`attempt_kind`), and whether the attempt
 * `succeeded` or `failed`.
 */
@Component({
  selector: 'app-login-attempts-page',
  standalone: true,
  imports: [CodeLabelPipe, DatePipe, MatCardModule, MatProgressBarModule, MockFilterBar],
  templateUrl: './login-attempts-page.html',
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

    .table-scroll {
      overflow-x: auto;
    }

    .attempts-table {
      width: 100%;
      border-collapse: collapse;
    }

    .attempts-table th,
    .attempts-table td {
      text-align: left;
      padding: 0.5rem 0.65rem 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }

    .attempts-table thead th {
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

    .badge--failed {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-weight: 600;
    }

    .badge--mock {
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
export class LoginAttemptsPage {
  private readonly api = inject(SecurityTelemetryApi);

  protected readonly includeMock = signal(false);
  protected readonly kindFilter = signal('all');
  protected readonly statusFilter = signal('all');

  protected readonly attemptKindLabels = ATTEMPT_KIND_LABELS;
  protected readonly statusLabels = STATUS_LABELS;

  private readonly attemptsResource = rxResource({
    params: () => this.includeMock(),
    stream: ({ params }) => this.api.loginAttempts(params),
  });

  protected readonly loading = computed(() => this.attemptsResource.isLoading());

  protected readonly allRows = computed<readonly AttemptViewModel[]>(() => {
    const rows = this.attemptsResource.hasValue() ? this.attemptsResource.value() : undefined;
    if (rows === undefined) {
      return [];
    }
    return rows.map((row) => ({
      ...row,
      showRawIp: row.ip !== row.ip_normalized,
    }));
  });

  protected readonly filteredRows = computed<readonly AttemptViewModel[]>(() => {
    const kind = this.kindFilter();
    const status = this.statusFilter();
    return this.allRows().filter((row) => {
      const matchesKind = kind === 'all' || row.attempt_kind === kind;
      const matchesStatus = status === 'all' || row.status === status;
      return matchesKind && matchesStatus;
    });
  });

  protected readonly summary = computed(() => {
    const count = this.filteredRows().length;
    return `${count} login ${count === 1 ? 'attempt' : 'attempts'} shown.`;
  });

  protected readonly failureReason = computed(() => {
    const error = this.attemptsResource.error();
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

  protected onKindChange(event: Event): void {
    this.kindFilter.set((event.target as HTMLSelectElement).value);
  }

  protected onStatusChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
  }
}
