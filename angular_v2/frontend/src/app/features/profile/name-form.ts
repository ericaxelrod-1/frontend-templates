import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, FormRoot } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { lastValueFrom } from 'rxjs';
import { describeProfileFailure } from './profile-failure';
import { ProfileApi } from './profile-api.service';
import type { ProfileMe } from './profile-me';
import type { ProfileUpdateRequest } from './profile-update-request';

/**
 * The one thing a member may change about themselves in a single request:
 * `first_name` and `last_name`, through `PATCH /api/users/me`.
 *
 * ## The model is a `linkedSignal`, and why that is the right primitive
 *
 * It is seeded from the loaded row and re-seeded whenever the row's identity
 * changes — which is exactly what happens after a successful save, because the page
 * reloads `GET /api/users/me` and the response is a fresh object. So the form shows
 * what the DATABASE stored, including any normalisation the server applied, and a
 * failed save leaves the member's edits alone instead of snapping them back. A
 * plain signal plus an `effect` would have had to do that by hand and would have
 * had a second way to clobber the draft.
 *
 * ## No validators, because the rules are the server's
 *
 * `users_first_name_not_blank` refuses `''` and untrimmed values
 * (`0023_user_profile_and_disable.sql`) precisely because `' '` is an absent answer
 * dressed as one. A client-side "required" on the name fields would reject the same
 * input with a different message and would be a second copy of the rule
 * (AGENTS.md §2.1: no hardcoded expected values in client-side validation logic).
 * The server's `422` is rendered in full — see `describeProfileFailure` — so the
 * member sees the actual reason.
 *
 * ## The submission action, not a subscription
 *
 * `submission.action` is `async` and awaited by the form, so there is no
 * `subscribe` on this component to give a teardown operator (AGENTS.md §F4).
 */
@Component({
  selector: 'app-profile-name-form',
  standalone: true,
  imports: [FormField, FormRoot, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './name-form.html',
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      max-width: 26rem;
    }

    mat-form-field {
      width: 100%;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .saved {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .notice {
      margin: 0;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }
  `,
})
export class ProfileNameForm {
  private readonly api = inject(ProfileApi);

  /**
   * The member's row, as the database last returned it. The form seeds itself from
   * it and re-seeds when its identity changes, so a reload after a save is what
   * clears "Saved".
   */
  readonly member = input.required<ProfileMe>();

  /** Emitted after the server has stored the change, so the page can reload. */
  readonly saved = output<void>();

  protected readonly submitting = signal(false);
  protected readonly savedAtLeastOnce = signal(false);
  protected readonly failureReason = signal<string | null>(null);

  private readonly draft = linkedSignal(() => ({
    first_name: this.member().first_name ?? '',
    last_name: this.member().last_name ?? '',
  }));

  protected readonly nameForm = form(this.draft, {
    submission: {
      action: async () => {
        await this.save();
        return [];
      },
    },
  });

  private async save(): Promise<void> {
    this.submitting.set(true);
    this.failureReason.set(null);
    try {
      const request: ProfileUpdateRequest = {
        first_name: this.draft().first_name,
        last_name: this.draft().last_name,
      };
      await lastValueFrom(this.api.updateMe(request));
      this.savedAtLeastOnce.set(true);
      this.saved.emit();
    } catch (error) {
      this.failureReason.set(describeProfileFailure(error, 'the name change'));
    } finally {
      this.submitting.set(false);
    }
  }
}