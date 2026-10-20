import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { lastValueFrom } from 'rxjs';
import { AuthApi } from '../../../core/auth/auth-api.service';
import type { AuthCaptchaChallenge, AuthLoginRequest } from '../../../core/auth/auth.types';
import { Session } from '../../../core/auth/session.service';

/**
 * Sign-in.
 *
 * The form is a Signal Form (`@angular/forms/signals`), which is the Angular 22
 * answer and needs no `FormGroup`, no `FormControl`, no `valueChanges`
 * subscription and no teardown operator. The model is a signal; the field state
 * is a signal; the template reads signals. There is therefore no manual
 * subscription on this page to give a subscription to.
 *
 * Anonymous visitors see this form and nothing else: `app.routes.ts` puts the
 * authenticated area behind `authGuard`, and this route is the only one the
 * server renders (see `app.routes.server.ts`).
 */
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [
    FormField,
    FormRoot,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './login-page.html',
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

    /*
     * A column, explicitly. \`mat-form-field\` is \`inline-flex\` by default, so
     * without this the username and password fields render side by side in one
     * row — which is a layout bug a unit test cannot see.
     */
    .form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    mat-form-field {
      width: 100%;
    }

    .notice {
      margin: 0.25rem 0 0.5rem;
    }

    .notice--error {
      color: var(--mat-sys-error);
    }

    /*
     * The challenge question. It is a paragraph rather than a hint inside the
     * field, because it is the thing being asked and it has to be readable
     * before the person knows what to type into the box below it.
     */
    .challenge {
      margin: 0.5rem 0 0;
      font-weight: 500;
    }
  `,
})
export class LoginPage {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly authApi = inject(AuthApi);

  protected readonly submitting = signal(false);
  protected readonly failureReason = signal<string | null>(null);

  /**
   * The challenge, when the server has demanded one.
   *
   * **`null` means no challenge is outstanding, and that is the normal case.**
   * The challenge is RISK-SCOPED: the server decides, from the account's
   * failure count, whether this sign-in has to carry one, and it says so by
   * answering the login with `428 Precondition Required`. Asking for a challenge
   * on every sign-in would be the blanket challenge `docs/security.md` names as
   * the anti-pattern, so this page never asks for one on its own initiative.
   */
  protected readonly challenge = signal<AuthCaptchaChallenge | null>(null);

  private readonly credentials = signal({ username: '', password: '', captchaAnswer: '' });

  /**
   * `username` and `password` are required because `LoginRequestDto` declares
   * `@IsString() @MinLength(1)` on both (`backend/src/auth/login-request.dto.ts`),
   * and the global `ValidationPipe` is configured with `forbidNonWhitelisted`, so
   * an empty field is a `400` and not a wrong-password answer. The client check
   * exists to say so locally; the server check is the one that counts.
   *
   * `captchaAnswer` carries no validator, and that is deliberate. It is only
   * required when a challenge is outstanding, and a validator that applied only
   * sometimes would be a validator whose rule changes underneath the field.
   * The requirement is checked where it can be explained — in `signIn`, which
   * says what is missing — and the server checks it again.
   */
  protected readonly loginForm = form(this.credentials, (path) => {
    required(path.username);
    required(path.password);
  }, {
    submission: {
      action: async () => {
        await this.signIn();
        return [];
      },
    },
  });

  private async signIn(): Promise<void> {
    this.submitting.set(true);
    this.failureReason.set(null);
    try {
      const { username, password, captchaAnswer } = this.credentials();
      const outstanding = this.challenge();

      if (outstanding !== null && captchaAnswer.trim() === '') {
        this.failureReason.set('Answer the question to sign in.');
        return;
      }

      const request: AuthLoginRequest =
        outstanding === null
          ? { username, password }
          : { username, password, captchaToken: outstanding.token, captchaAnswer };

      await lastValueFrom(this.session.login(request));
      // `/profile`, matching the shell's `/` redirect: it is the one route every
      // signed-in user can act on, so an administrator lands there and is one click
      // from the Users page and a member is not shown a page they cannot use.
      await this.router.navigateByUrl('/profile');
    } catch (error) {
      // The server refused this sign-in because the account's failure count says
      // the risk is elevated. That is not a credential refusal and it is not an
      // error: it is the request arriving without the thing the request needed.
      // So the page asks for a challenge and lets the person answer it.
      if (isCaptchaRequired(error)) {
        await this.requestChallenge();
        return;
      }
      // Nothing is swallowed: the reason reaches the page, and the cause is on
      // the wire in the network tab.
      this.failureReason.set(describeLoginFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * Ask for a challenge and show it.
   *
   * **The previous answer is discarded and the box is emptied**, because a
   * challenge is single-use: the server spends it on the first verification
   * attempt, whether that attempt was right or wrong. Keeping the old token
   * would mean the next submission presented a spent one and failed for a
   * reason the page could not explain.
   */
  private async requestChallenge(): Promise<void> {
    try {
      const challenge = await lastValueFrom(this.authApi.issueCaptcha());
      this.challenge.set(challenge);
      this.credentials.update((current) => ({ ...current, captchaAnswer: '' }));
    } catch (error) {
      this.failureReason.set(describeLoginFailure(error));
    }
  }
}

/**
 * Whether the server asked for a challenge.
 *
 * `428 Precondition Required` is the status the backend uses for it
 * (`CaptchaRequiredException`), and it is deliberately not the generic `401`:
 * one means "these credentials were not accepted" and the other means "this
 * request needs something else attached".
 */
function isCaptchaRequired(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 428;
}

/**
 * What the page says when sign-in fails.
 *
 * The `401` case deliberately does not distinguish an unknown username from a
 * wrong password, because the backend does not either, and a page that did would
 * be reporting more than the application knows.
 */
function describeLoginFailure(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    switch (error.status) {
      case 401:
        return 'That username and password were not accepted.';
      case 428:
        return 'A challenge is needed before this sign-in can be checked.';
      case 429:
        return 'Too many attempts. Wait before trying again.';
      case 0:
        return 'The sign-in service could not be reached.';
      default:
        return `Sign-in failed: HTTP ${error.status}.`;
    }
  }
  return 'Sign-in failed.';
}
