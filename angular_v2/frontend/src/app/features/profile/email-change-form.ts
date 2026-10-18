import { Component, inject, input, output, signal } from '@angular/core';
import { email, form, FormField, FormRoot, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { lastValueFrom } from 'rxjs';
import { describeProfileFailure } from './profile-failure';
import { ProfileApi } from './profile-api.service';

/**
 * The email-change form, and the two-phase flow it has to represent honestly.
 *
 * ## `POST /api/users/me/email` is a REQUEST, not an edit
 *
 * The route answers `202 { accepted: true }` and **does not change the address.**
 * A verification link is sent to the new address, and the address changes only when
 * the member opens that link. Nothing else about the account moves in the meantime:
 * `users.email` still holds the old address, and mail still goes there.
 *
 * So this form never renders the submitted address as the account's. It keeps it in
 * `pendingAddress`, which the template labels as pending and pairs with the address
 * that is still on file. The alternative — echoing the input back into the "your
 * email" field — is the specific failure this page exists to avoid: a member reads
 * an address on their profile, believes it is theirs, and discovers otherwise when
 * mail stops arriving.
 *
 * `accepted: true` is the whole body of that `202` on purpose
 * (`email-change-accepted.ts`), so the page cannot render the pending address from
 * the response even by accident.
 *
 * ## The client checks the SHAPE of an address; the server decides whether it is one
 *
 * `required` and `email()` here are about not sending an obviously malformed value,
 * and they exist because `email()` is a format check with no opinion about
 * deliverability. Whether an address may be used for an account — uniqueness,
 * disposable domains, anything a policy adds — is the server's call and comes back as
 * `422` with the reason, which is rendered rather than summarised.
 *
 * ## Re-requesting is not a mistake the page invents a story about
 *
 * Asking twice sends two links; it does not change the pending address without the
 * second link being opened. The form reports what happened and leaves the member in
 * charge of which link they open.
 */
@Component({
  selector: 'app-email-change-form',
  standalone: true,
  imports: [FormField, FormRoot, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './email-change-form.html',
  styles: `
    .explain {
      margin: 0 0 0.75rem;
      max-width: 40rem;
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      max-width: 26rem;
    }

    mat-form-field {
      width: 100%;
    }

    .notice {
      margin: 0 0 0.75rem;
      max-width: 40rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }

    .notice--pending {
      display: block;
      padding: 0.5rem 0.75rem;
      border-left: 3px solid var(--mat-sys-primary);
      background: var(--mat-sys-surface-container-high);
    }
  `,
})
export class EmailChangeForm {
  private readonly api = inject(ProfileApi);

  /**
   * The address the DATABASE last returned on `GET /api/users/me`.
   *
   * It is an input and not something this component fetches, for one reason: it is
   * the address on file, and this route cannot change it. It stays on screen after a
   * successful request so the pending address can be shown next to the real one,
   * which is the only way the two-phase flow is legible.
   */
  readonly currentEmail = input.required<string>();

  /** Emitted once the request has been accepted, so the page can reload the row. */
  readonly requested = output<void>();

  protected readonly submitting = signal(false);
  protected readonly failureReason = signal<string | null>(null);

  /**
   * The address a verification link was sent to — NOT the address on the account.
   *
   * It is local to this component rather than read back from the API on purpose:
   * `GET /api/users/me` cannot return it, because nothing has changed yet and there
   * is no column holding it. Keeping it here is what lets the template say "still
   * <current>" with a fact behind it.
   */
  protected readonly pendingAddress = signal<string | null>(null);

  private readonly draft = signal({ email: '' });

  protected readonly emailForm = form(
    this.draft,
    (path) => {
      required(path.email);
      email(path.email);
    },
    {
      submission: {
        action: async () => {
          await this.requestChange();
          return [];
        },
      },
    },
  );

  private async requestChange(): Promise<void> {
    this.submitting.set(true);
    this.failureReason.set(null);
    const requested = this.draft().email.trim();
    try {
      await lastValueFrom(this.api.requestEmailChange({ email: requested }));
      // The `202` is the whole of what changed. The address is NOT applied here, so
      // the submitted value is recorded as pending and the input is cleared —
      // leaving it in the box would read as "this is now your address".
      this.pendingAddress.set(requested);
      this.draft.set({ email: '' });
      this.requested.emit();
    } catch (error) {
      this.failureReason.set(describeProfileFailure(error, 'the email change request'));
    } finally {
      this.submitting.set(false);
    }
  }
}