import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { GeoPlace } from '../../shared/geo-place';
import { EmailChangeForm } from './email-change-form';
import { ProfileLoginHistory } from './login-history';
import { ProfileNameForm } from './name-form';
import { ProfilePasswordForm } from './password-change-form';
import { ProfileConsentForm } from './consent-form';
import { ProfileApi } from './profile-api.service';
import { describeProfileFailure } from './profile-failure';

/**
 * A member's own profile: what the database holds about them, and the three things
 * they may change.
 *
 * ## It is a DIFFERENT page from Users, for a different reader
 *
 * The Users page answers "what does an operator need to know about every account".
 * This one answers "what is mine, and what may I change", and the difference is
 * enforced by the column grant rather than by a flag in the UI: `ProfileMe` is a
 * `Pick` of exactly the twelve columns `app_member` holds, so nothing admin-only
 * can be rendered here even by accident. Requesting one of them would fail the
 * whole read with `403`, which is why the page SAYS the four things it cannot show
 * instead of quietly omitting them:
 *
 * - when the account last passed a credential check, and when it was last observed;
 * - whether the address on file has been verified (`email_verified_at`);
 * - whether the account is disabled, and until when;
 * - whether an erasure was recorded, and whether the address was anonymized.
 *
 * Each of those is a real thing a member would like to know, so the page states that
 * it cannot know it and does not manufacture a local substitute. In particular there
 * is no "verified" badge on the email: `email_verified_at` is a timestamp and is
 * outside the grant, so any badge here would be invented.
 *
 * ## It owns no HTTP
 *
 * `ProfileApi` does every call, `Session` still owns the tokens and the identity
 * (AGENTS.md §F3), and this component injects neither `HttpClient` nor a state
 * library. The two child forms hold their own draft state because a draft is local
 * to a form; what is on the server is never mirrored into a second store.
 */
@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [
    DatePipe,
    EmailChangeForm,
    GeoPlace,
    MatCardModule,
    MatProgressBarModule,
    ProfileLoginHistory,
    ProfileNameForm,
    ProfilePasswordForm,
    ProfileConsentForm,
  ],
  templateUrl: './profile-page.html',
  styles: `
    :host {
      display: block;
    }

    .page {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .identity {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
      margin: 0 0 0.75rem;
    }

    .identity div {
      display: flex;
      flex-direction: column;
    }

    .identity dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }

    .identity dd {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }

    .not-shown {
      margin: 0;
      max-width: 46rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .notice {
      margin: 0 0 0.75rem;
      max-width: 46rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  `,
})
export class ProfilePage {
  private readonly api = inject(ProfileApi);

  private readonly memberResource = rxResource({ stream: () => this.api.me() });

  protected readonly loading = computed(() => this.memberResource.isLoading());

  /**
   * `hasValue()` first, not `value() !== undefined`: `.value()` THROWS on a resource
   * that is in an error state, and this computed runs exactly when the read failed.
   * The failure notice is what the page renders in that case, never a blank profile.
   */
  protected readonly member = computed(() =>
    this.memberResource.hasValue() ? this.memberResource.value() : undefined,
  );

  protected readonly failureReason = computed(() => {
    const error = this.memberResource.error();
    if (error === undefined) {
      return null;
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'This session may not read its own profile (403).';
    }
    return describeProfileFailure(error, 'the profile');
  });

  /**
   * Re-reads the row after a change.
   *
   * The saved value is whatever the server returns, not what was typed: the response
   * to `PATCH /api/users/me` is the refreshed row, and re-reading rather than
   * writing it locally is what makes "the name form shows the stored name" true even
   * when the server trimmed or refused something.
   */
  protected reload(): void {
    this.memberResource.reload();
  }
}