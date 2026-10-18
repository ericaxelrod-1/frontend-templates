import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CodeLabelPipe } from '../../shared/code-label';
import { ProfileApi } from './profile-api.service';
import type { ProfileLoginAttempt } from './login-attempt';

/**
 * `login_attempts.status`, closed to `('failed', 'succeeded')` by a `CHECK` in
 * `0002_refresh_tokens.sql`.
 */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  succeeded: 'succeeded',
  failed: 'failed',
};

/**
 * `login_attempts.attempt_kind`, closed to `('login', 'token_request')` by
 * `login_attempts_attempt_kind_check` in `0019_login_attempt_kind.sql`.
 *
 * The two populations are separate on purpose: `0019` keeps the per-account
 * counters from mixing sign-ins with access-token grants, so this table shows
 * which of the two a row belongs to rather than flattening them into "sign-in
 * attempt".
 */
const ATTEMPT_KIND_LABELS: Readonly<Record<string, string>> = {
  login: 'sign-in',
  token_request: 'access token request',
};

/**
 * The member's own sign-in history: `GET /api/users/me/login-attempts`.
 *
 * ## Matched by username, and that is not an oversight
 *
 * `login_attempts` has NO `user_id` column. It is deliberately text, because an
 * attempt against a username that does not exist still has to be recorded — a
 * brute-force sweep names accounts that are not there, and a table that could only
 * hold a row for a real account would make the sweep invisible and uncountable.
 * The cost of that decision is that the history is matched on `username`, which
 * reads like a missing foreign key until you know why.
 *
 * It does not fragment. `users.username` is immutable (`0008_user_identity.sql`),
 * so attempts recorded under the name someone signed in with are still theirs after
 * anything else about the account has changed.
 *
 * ## Both addresses, on purpose
 *
 * `ip` is the observed address and `ip_subnet` is the aggregate the reputation
 * counters key on, so showing them together is what lets a member tell "one machine
 * I do not recognise" from "many machines behind one address". A table with only
 * `ip` would make the second case look like the first.
 *
 * The route is the only source for this data: a member has no column grant on
 * `login_attempts` and no RLS scope that would admit a read of it, so this is
 * deliberately NOT a PostgREST query — the thin app resolves the caller's own
 * username and returns only those rows.
 */
@Component({
  selector: 'app-profile-login-history',
  standalone: true,
  imports: [CodeLabelPipe, DatePipe, MatProgressBarModule],
  templateUrl: './login-history.html',
  styles: `
    :host {
      display: block;
    }

    .attempts__caption {
      caption-side: top;
      text-align: left;
      padding-bottom: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .attempts__scroll {
      overflow-x: auto;
    }

    .attempts {
      width: 100%;
      border-collapse: collapse;
    }

    .attempts th,
    .attempts td {
      text-align: left;
      padding: 0.4rem 0.75rem 0.4rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      white-space: nowrap;
    }

    .attempts thead th {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .attempts__absent,
    .attempts__empty {
      color: var(--mat-sys-on-surface-variant);
    }

    .attempts__failed {
      color: var(--mat-sys-error);
    }

    .notice {
      margin: 0 0 0.75rem;
      max-width: 40rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }
  `,
})
export class ProfileLoginHistory {
  private readonly api = inject(ProfileApi);

  private readonly attemptsResource = rxResource({ stream: () => this.api.loginAttempts() });

  /** The two vocabularies, exposed for the `codeLabel` pipe. */
  protected readonly statuses = STATUS_LABELS;
  protected readonly attemptKinds = ATTEMPT_KIND_LABELS;

  protected readonly loading = computed(() => this.attemptsResource.isLoading());

  /**
   * `hasValue()` first, not `value() ?? []`: `.value()` THROWS on a resource that is
   * in an error state, so `?? []` would never get the chance to substitute. The
   * failure notice renders alongside this list.
   */
  protected readonly attempts = computed<readonly ProfileLoginAttempt[]>(() =>
    this.attemptsResource.hasValue() ? this.attemptsResource.value() : [],
  );

  protected readonly failureReason = computed(() => {
    const error = this.attemptsResource.error();
    if (error === undefined) {
      return null;
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'This session may not read its own sign-in history (403).';
    }
    return error instanceof HttpErrorResponse
      ? `The history could not be read: HTTP ${error.status}.`
      : 'The history could not be read.';
  });
}