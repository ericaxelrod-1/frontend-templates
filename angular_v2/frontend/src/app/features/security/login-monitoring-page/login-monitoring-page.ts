import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CodeLabelPipe } from '../../../shared/code-label';
import { MockFilterBar } from '../mock-filter-bar';
import { SecurityTelemetryApi } from '../security-telemetry-api.service';
import type { LoginAttemptWithMock, SecurityAlertRow } from '../security-telemetry.types';

const ATTEMPT_KIND_LABELS: Readonly<Record<string, string>> = {
  login: 'Credential check (login)',
  token_request: 'Reset/verification token (token_request)',
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
};

interface MonitoredAttemptRow extends LoginAttemptWithMock {
  readonly showRawIp: boolean;
  readonly relatedAlertTitles: readonly string[];
}

/**
 * `/admin/login-monitoring` — operational view over `public.login_attempts` and
 * the `public.security_alerts` raised around them.
 *
 * Separates the two rate-limit budgets introduced in `0019_login_attempt_kind.sql`
 * (`login` credential checks vs `token_request` password-reset/verification token
 * requests) so a flood of unauthenticated token requests never masks or exhausts
 * interactive sign-in monitoring.
 */
@Component({
  selector: 'app-login-monitoring-page',
  standalone: true,
  imports: [
    CodeLabelPipe,
    DatePipe,
    MatCardModule,
    MatExpansionModule,
    MatProgressBarModule,
    MockFilterBar,
  ],
  templateUrl: './login-monitoring-page.html',
  styles: `
    :host {
      display: block;
    }

    .budgets {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .budget-box {
      padding: 0.75rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
      background: var(--mat-sys-surface-container-lowest);
    }

    .budget-box__title {
      font: var(--mat-sys-label-large);
      margin: 0 0 0.25rem;
    }

    .budget-box__stats {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }

    .budget-box__sub {
      margin: 0.15rem 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .table-scroll {
      overflow-x: auto;
    }

    .mon-table {
      width: 100%;
      border-collapse: collapse;
    }

    .mon-table th,
    .mon-table td {
      text-align: left;
      padding: 0.5rem 0.65rem 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }

    .mon-table thead th {
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

    .mon__details {
      display: block;
      margin-top: 1rem;
    }

    .mon__detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 0.75rem 1.25rem;
      margin: 0;
    }

    .mon__detail-item {
      margin: 0;
    }

    .mon__detail-item dt {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 0.15rem;
    }

    .mon__detail-item dd {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }

    .mon__alerts-list {
      margin: 0;
      padding-left: 1.1rem;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  `,
})
export class LoginMonitoringPage {
  private readonly api = inject(SecurityTelemetryApi);

  protected readonly includeMock = signal(false);
  protected readonly attemptKindLabels = ATTEMPT_KIND_LABELS;
  protected readonly statusLabels = STATUS_LABELS;

  private readonly attemptsResource = rxResource({
    params: () => this.includeMock(),
    stream: ({ params }) => this.api.loginAttempts(params),
  });

  private readonly alertsResource = rxResource({
    params: () => this.includeMock(),
    stream: ({ params }) => this.api.securityAlerts(params),
  });

  protected readonly loading = computed(
    () => this.attemptsResource.isLoading() || this.alertsResource.isLoading(),
  );

  protected readonly alerts = computed<readonly SecurityAlertRow[]>(() =>
    this.alertsResource.hasValue() ? this.alertsResource.value() : [],
  );

  protected readonly rows = computed<readonly MonitoredAttemptRow[]>(() => {
    const attempts = this.attemptsResource.hasValue() ? this.attemptsResource.value() : undefined;
    if (attempts === undefined) {
      return [];
    }
    const alerts = this.alerts();
    return attempts.map((attempt) => ({
      ...attempt,
      showRawIp: attempt.ip !== attempt.ip_normalized,
      relatedAlertTitles: matchAlerts(attempt, alerts),
    }));
  });

  protected readonly loginBudgetStats = computed(() => {
    const loginRows = this.rows().filter((r) => r.attempt_kind === 'login');
    const failed = loginRows.filter((r) => r.status === 'failed').length;
    return `${loginRows.length} total (${failed} failed)`;
  });

  protected readonly tokenBudgetStats = computed(() => {
    const tokenRows = this.rows().filter((r) => r.attempt_kind === 'token_request');
    const failed = tokenRows.filter((r) => r.status === 'failed').length;
    return `${tokenRows.length} total (${failed} failed)`;
  });

  protected readonly summary = computed(() => {
    const count = this.rows().length;
    const alertCount = this.alerts().length;
    return `${count} monitored ${count === 1 ? 'attempt' : 'attempts'} and ${alertCount} correlated ${alertCount === 1 ? 'alert' : 'alerts'}.`;
  });

  protected readonly failureReason = computed(() => {
    const error = this.attemptsResource.error() ?? this.alertsResource.error();
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

function matchAlerts(
  attempt: LoginAttemptWithMock,
  alerts: readonly SecurityAlertRow[],
): readonly string[] {
  const titles: string[] = [];
  for (const alert of alerts) {
    const sameNormalized =
      alert.ip_normalized !== undefined && alert.ip_normalized === attempt.ip_normalized;
    const sameSubnet = alert.ip_subnet !== undefined && alert.ip_subnet === attempt.ip_subnet;
    if (sameNormalized || sameSubnet) {
      titles.push(alert.title);
    }
  }
  return titles;
}
