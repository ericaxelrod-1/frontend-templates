import { isPlatformBrowser } from '@angular/common';
import { Component, type OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { TokenRedemptionApi } from '../../../core/auth/token-redemption-api.service';
import { extractTokenErrorMessage } from '../../../core/auth/token-redemption.types';

/**
 * Public password reset page (`/reset-password`).
 *
 * ## CRITICAL DESIGN RULE: DO NOT REDEEM ON GET
 *
 * This page deliberately does NOT redeem the token on GET / page load.
 * A link preview unfurl in chat (Slack, Discord, Teams), an email scanning proxy,
 * or an automated prefetch crawler following links in emails would immediately consume
 * and burn the single-use token if redemption occurred on GET.
 * Redemption happens ONLY upon deliberate user submission (POST) of the new password form.
 *
 * ## TWO STATES ON ONE ROUTE
 *
 * - With `?token=`: Displays the new-password form.
 * - Without token: Informs the visitor that the link is incomplete rather than showing an empty form.
 *
 * ## REFUSAL REPORTING
 *
 * On submit, failure modes (unusable token or weak password failing backend password-policy)
 * are rendered faithfully using the server's returned message.
 */
@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [
    FormField,
    FormRoot,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
  ],
  templateUrl: './reset-password-page.html',
  styles: `
    :host {
      display: block;
    }

    .page {
      display: flex;
      justify-content: center;
      padding: 3rem 1rem;
    }

    .card {
      width: min(26rem, 100%);
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    mat-form-field {
      width: 100%;
    }

    .notice {
      margin: 0.5rem 0 1rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }

    .notice--success {
      color: var(--mat-sys-primary);
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
  `,
})
export class ResetPasswordPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(TokenRedemptionApi);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly hasToken = signal(false);
  protected readonly submitting = signal(false);
  protected readonly success = signal(false);
  protected readonly failureReason = signal<string | null>(null);

  private readonly tokenValue = signal<string | null>(null);
  private readonly draft = signal({ password: '' });

  protected readonly resetForm = form(
    this.draft,
    (path) => {
      required(path.password);
    },
    {
      submission: {
        action: async () => {
          await this.submitNewPassword();
          return [];
        },
      },
    },
  );

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      // In SSR, do not access browser globals or assume tokens
      return;
    }

    const token = this.route.snapshot.queryParamMap.get('token');
    if (token !== null && token.trim() !== '') {
      this.tokenValue.set(token.trim());
      this.hasToken.set(true);
    } else {
      this.hasToken.set(false);
    }
  }

  private async submitNewPassword(): Promise<void> {
    const token = this.tokenValue();
    if (token === null || token === '') {
      this.failureReason.set('No reset token is available. Please reopen the link from your email.');
      return;
    }

    this.submitting.set(true);
    this.failureReason.set(null);

    try {
      // Token is transmitted in the POST body only, never in URL query string or logged
      await lastValueFrom(
        this.api.confirmPasswordReset({
          token,
          password: this.draft().password,
        }),
      );
      this.draft.set({ password: '' });
      this.success.set(true);
    } catch (error) {
      const message = extractTokenErrorMessage(error);
      this.failureReason.set(message ?? 'Password reset failed.');
    } finally {
      this.submitting.set(false);
    }
  }
}
