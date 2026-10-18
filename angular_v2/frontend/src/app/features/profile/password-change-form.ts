import { Component, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { lastValueFrom } from 'rxjs';
import { describeProfileFailure } from './profile-failure';
import { ProfileApi } from './profile-api.service';
import type { PasswordChangeRequest } from './password-change-request';

/**
 * `POST /api/users/me/password`: prove the current password, set a new one.
 *
 * ## A wrong current password must NOT be answered `401`
 *
 * That is a constraint on the backend and it is load-bearing, not a stylistic
 * choice. `authInterceptor` treats a `401` on a request that carried a token as the
 * end of the session: it clears the tokens and sends the browser to
 * `/access-denied`. So a backend that answered `401` for a mistyped
 * `current_password` would sign the member out for mistyping their own password, and
 * would make the two failures indistinguishable in the UI — "your password was
 * wrong" and "your session is over" would be the same page.
 *
 * `401` therefore means "the API would not accept this token", and a rejected
 * current password is a field-level refusal: `422`, with the server's reason. This
 * component renders whatever comes back rather than guessing which it was.
 *
 * ## Both fields are cleared on success, and nothing else is claimed
 *
 * The page says the password changed. It does not say other sessions were ended, or
 * that refresh tokens were revoked: whether this route invalidates them is the
 * backend's decision (`refresh_tokens` rotation is AGENTS.md §B5's business), and a
 * page that asserted it either way would be a comment in the UI that can be wrong.
 *
 * ## No confirmation field
 *
 * The contract is `{ current_password, new_password }` and nothing else. A
 * "confirm new password" box is a client-side invention whose only rule would be
 * "the two boxes match", and it would be a second thing to get wrong in a form
 * whose real rules — length, complexity, similarity to the old one — belong to the
 * server and come back as `422`.
 */
@Component({
  selector: 'app-profile-password-form',
  standalone: true,
  imports: [FormField, FormRoot, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './password-change-form.html',
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

    .changed {
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
export class ProfilePasswordForm {
  private readonly api = inject(ProfileApi);

  protected readonly submitting = signal(false);
  protected readonly changed = signal(false);
  protected readonly failureReason = signal<string | null>(null);

  private readonly draft = signal({ current_password: '', new_password: '' });

  protected readonly passwordForm = form(
    this.draft,
    (path) => {
      required(path.current_password);
      required(path.new_password);
    },
    {
      submission: {
        action: async () => {
          await this.changePassword();
          return [];
        },
      },
    },
  );

  private async changePassword(): Promise<void> {
    this.submitting.set(true);
    this.failureReason.set(null);
    this.changed.set(false);
    try {
      const request: PasswordChangeRequest = {
        current_password: this.draft().current_password,
        new_password: this.draft().new_password,
      };
      await lastValueFrom(this.api.changePassword(request));
      // The route answers 204, so there is nothing to show and nothing to render
      // back. Clearing both boxes is the honest end state: the values are spent.
      this.draft.set({ current_password: '', new_password: '' });
      this.changed.set(true);
    } catch (error) {
      this.failureReason.set(describeProfileFailure(error, 'the password change'));
    } finally {
      this.submitting.set(false);
    }
  }
}