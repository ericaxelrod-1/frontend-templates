import { isPlatformBrowser } from '@angular/common';
import { Component, type OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { TokenRedemptionApi } from '../../../core/auth/token-redemption-api.service';
import { extractTokenErrorMessage } from '../../../core/auth/token-redemption.types';

export type VerifyEmailState =
  | 'ssr_rendering'
  | 'missing_token'
  | 'verifying'
  | 'confirmed'
  | 'refused';

/**
 * Public email verification redemption page (`/verify-email`).
 *
 * ## UNAUTHENTICATED TOKEN REDEMPTION
 *
 * The visitor opened a link from their email containing `?token=...`. The token IS the
 * authentication for this action, so no existing session is required or checked.
 *
 * ## SSR AND BROWSER SAFETY
 *
 * In SSR mode (`isPlatformBrowser` is false), the server renders the structural shell without
 * attempting network calls or touching browser globals. This prevents premature token redemption
 * during pre-rendering and avoids hydration mismatches. The browser hydrates and triggers
 * the actual single-use token redemption against `POST /api/auth/email-verification/confirm`.
 *
 * ## NO TOKENS IN QUERY STRINGS OR LOGS
 *
 * The token remains in the incoming URL query parameter and is supplied strictly in the POST
 * body to the backend. It is never logged or forwarded elsewhere.
 */
@Component({
  selector: 'app-verify-email-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, RouterLink],
  templateUrl: './verify-email-page.html',
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
      margin-top: 1rem;
    }
  `,
})
export class VerifyEmailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(TokenRedemptionApi);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly state = signal<VerifyEmailState>('ssr_rendering');
  protected readonly failureReason = signal<string | null>(null);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.state.set('ssr_rendering');
      return;
    }

    const token = this.route.snapshot.queryParamMap.get('token');
    if (token === null || token.trim() === '') {
      this.state.set('missing_token');
      return;
    }

    void this.verifyEmail(token.trim());
  }

  private async verifyEmail(token: string): Promise<void> {
    this.state.set('verifying');
    this.failureReason.set(null);

    try {
      await lastValueFrom(this.api.confirmEmailVerification({ token }));
      this.state.set('confirmed');
    } catch (error) {
      const serverMessage = extractTokenErrorMessage(error);
      this.failureReason.set(
        serverMessage ?? 'This verification link is not valid, has already been used, or has expired.',
      );
      this.state.set('refused');
    }
  }
}
