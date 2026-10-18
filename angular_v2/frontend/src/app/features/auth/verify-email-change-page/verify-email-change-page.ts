import { isPlatformBrowser } from '@angular/common';
import { Component, type OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { TokenRedemptionApi } from '../../../core/auth/token-redemption-api.service';
import { extractTokenErrorMessage } from '../../../core/auth/token-redemption.types';

export type VerifyEmailChangeState =
  | 'ssr_rendering'
  | 'missing_token'
  | 'verifying'
  | 'confirmed'
  | 'refused';

/**
 * Public email change verification page (`/verify-email-change`).
 *
 * ## UNAUTHENTICATED TOKEN REDEMPTION
 *
 * The visitor clicked a confirmation link sent to their new email mailbox.
 * The endpoint `POST /api/users/me/email/confirm` is `@Public()` because the token itself
 * is the cryptographic bearer credential proving mailbox control. The recipient may be signed
 * out or on a completely different device, so no active session is required.
 *
 * ## SSR AND BROWSER SAFETY
 *
 * In SSR mode (`isPlatformBrowser` is false), the server renders the structural shell without
 * making network calls or touching browser globals. When hydration runs in the browser,
 * the token is read from the URL query parameter and submitted in the POST body.
 *
 * ## ADDRESS CHANGE AND SIGN-IN NOTICE
 *
 * On confirmation, the database updates `users.email` and sets `email_verified_at = now()`.
 * The page informs the visitor that their address has changed and advises signing in again
 * if they held an active session.
 */
@Component({
  selector: 'app-verify-email-change-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, RouterLink],
  templateUrl: './verify-email-change-page.html',
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
export class VerifyEmailChangePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(TokenRedemptionApi);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly state = signal<VerifyEmailChangeState>('ssr_rendering');
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

    void this.verifyEmailChange(token.trim());
  }

  private async verifyEmailChange(token: string): Promise<void> {
    this.state.set('verifying');
    this.failureReason.set(null);

    try {
      await lastValueFrom(this.api.confirmEmailChange({ token }));
      this.state.set('confirmed');
    } catch (error) {
      const serverMessage = extractTokenErrorMessage(error);
      this.failureReason.set(
        serverMessage ?? 'This confirmation link is not valid, has already been used, or has expired.',
      );
      this.state.set('refused');
    }
  }
}
