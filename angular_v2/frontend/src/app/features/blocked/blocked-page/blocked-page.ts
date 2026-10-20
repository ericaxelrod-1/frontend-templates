import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { CodeLabelPipe } from '../../../shared/code-label';
import { BlockedApi } from '../blocked-api.service';
import type { DisabledUserRow } from '../blocked.types';
import { SuspensionInfoPipe } from '../suspension-info.pipe';

const DISABLED_REASON_LABELS: Readonly<Record<string, string>> = {
  admin: 'administrator action',
  security: 'automated security block',
  compliance: 'statutory obligation',
  user_request: 'requested by the member',
};

/**
 * Administration view for disabled and suspended accounts.
 *
 * ## THE QUESTIONS THIS AREA ANSWERS
 *
 * 1. Which accounts are disabled? (Identifies username, email, full name, ID).
 * 2. Who disabled them and when? (`disabled_by` administrator UUID or automated system,
 *    and `disabled_at` timestamp).
 * 3. Why were they disabled? (`disabled_reason` from closed vocabulary).
 * 4. Is the disable permanent or temporary? (`disabled_until === null` is permanent;
 *    `disabled_until !== null` is temporary, with active vs expired suspension states).
 * 5. Can they be re-enabled? Yes, an administrator can lift the disable.
 *
 * ## NON-ADMINISTRATOR BEHAVIOR
 *
 * For non-administrators (`app_member`), the `disabled_*` columns are not granted
 * (0023). PostgREST returns 403 Forbidden, which this component displays as
 * "not readable for this role" (AGENTS.md §F7).
 */
@Component({
  selector: 'app-blocked-page',
  standalone: true,
  imports: [
    CodeLabelPipe,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    SuspensionInfoPipe,
  ],
  templateUrl: './blocked-page.html',
  styles: `
    :host {
      display: block;
      max-width: 72rem;
      margin: 0 auto;
      padding: 1rem;
    }

    .blocked-card {
      margin-bottom: 1.5rem;
    }

    .suspension-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
    }

    .suspension-badge--permanent {
      background-color: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }

    .suspension-badge--active {
      background-color: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }

    .suspension-badge--expired {
      background-color: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }

    .blocked-notice {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      padding: 1.5rem;
      text-align: center;
    }

    .table-container {
      overflow-x: auto;
    }

    table {
      width: 100%;
    }

    .actor-cell {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .actor-uuid {
      font-family: monospace;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .feedback-box {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background-color: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  `,
})
export class BlockedPage {
  private readonly blockedApi = inject(BlockedApi);

  protected readonly users = signal<readonly DisabledUserRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly notReadable = signal(false);
  protected readonly reEnablingId = signal<string | null>(null);
  protected readonly feedback = signal<string | null>(null);

  protected readonly disabledReasons = DISABLED_REASON_LABELS;
  protected readonly displayedColumns = [
    'username',
    'disabledAt',
    'disabledBy',
    'reason',
    'type',
    'actions',
  ];

  constructor() {
    this.loadDisabledUsers();
  }

  loadDisabledUsers(): void {
    this.loading.set(true);
    this.notReadable.set(false);

    this.blockedApi.blockedUsers().subscribe({
      next: (data) => {
        this.users.set(data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        if (err instanceof HttpErrorResponse && (err.status === 403 || err.status === 401)) {
          this.notReadable.set(true);
        } else {
          this.notReadable.set(true);
        }
      },
    });
  }

  protected reEnableAccount(user: DisabledUserRow): void {
    this.reEnablingId.set(user.id);
    this.feedback.set(null);

    this.blockedApi.reEnable(user.id).subscribe({
      next: () => {
        this.reEnablingId.set(null);
        this.feedback.set(`Account for "${user.username}" has been re-enabled.`);
        this.loadDisabledUsers();
      },
      error: (err: unknown) => {
        this.reEnablingId.set(null);
        const msg = err instanceof Error ? err.message : 'Failed to re-enable account';
        this.feedback.set(`Error: ${msg}`);
      },
    });
  }

  protected clearFeedback(): void {
    this.feedback.set(null);
  }
}
