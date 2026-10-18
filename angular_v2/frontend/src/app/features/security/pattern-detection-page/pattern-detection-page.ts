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
import type { DetectedPatternWithAttempts } from '../security-telemetry.types';

const SEVERITY_LABELS: Readonly<Record<string, string>> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'Active',
  investigating: 'Investigating',
  resolved: 'Resolved',
  false_positive: 'False positive',
};

const ATTEMPT_KIND_LABELS: Readonly<Record<string, string>> = {
  login: 'Credential check (login)',
  token_request: 'Reset/verification token (token_request)',
};

/**
 * `/admin/pattern-detection` — operator view over `public.security_detected_patterns`
 * joined with `public.pattern_login_attempts` and `public.login_attempts`.
 *
 * Shows `pattern_type`, `severity`, `status`, the observation window
 * (`time_window_start`–`time_window_end`), `attempt_count`, `unique_email_count`,
 * structured `evidence` (`jsonb` rendered as key/value pairs rather than raw JSON),
 * and the correlated login attempts.
 */
@Component({
  selector: 'app-pattern-detection-page',
  standalone: true,
  imports: [
    CodeLabelPipe,
    DatePipe,
    JsonbEntriesPipe,
    MatCardModule,
    MatProgressBarModule,
    MockFilterBar,
  ],
  templateUrl: './pattern-detection-page.html',
  styles: `
    :host {
      display: block;
    }

    .patterns {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    .pattern-card {
      padding: 0.9rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
      background: var(--mat-sys-surface);
    }

    .pattern-card__header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }

    .pattern-card__title {
      font: var(--mat-sys-title-small);
      margin: 0;
    }

    .badges {
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

    .badge--mock {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }

    .pattern-card__desc {
      margin: 0 0 0.6rem;
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

    .section {
      margin-top: 0.65rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font: var(--mat-sys-body-small);
    }

    .section__heading {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 0.35rem;
    }

    .evidence-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 0.35rem 1rem;
      margin: 0;
    }

    .evidence-list dt {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .evidence-list dd {
      margin: 0;
    }

    .attempts-list {
      margin: 0;
      padding-left: 1.1rem;
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
export class PatternDetectionPage {
  private readonly api = inject(SecurityTelemetryApi);

  protected readonly includeMock = signal(false);
  protected readonly severityLabels = SEVERITY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly attemptKindLabels = ATTEMPT_KIND_LABELS;

  private readonly patternsResource = rxResource({
    params: () => this.includeMock(),
    stream: ({ params }) => this.api.detectedPatterns(params),
  });

  protected readonly loading = computed(() => this.patternsResource.isLoading());

  protected readonly rows = computed<readonly DetectedPatternWithAttempts[]>(() =>
    this.patternsResource.hasValue() ? this.patternsResource.value() : [],
  );

  protected readonly summary = computed(() => {
    const count = this.rows().length;
    return `${count} detected ${count === 1 ? 'pattern' : 'patterns'} returned.`;
  });

  protected readonly failureReason = computed(() => {
    const error = this.patternsResource.error();
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
