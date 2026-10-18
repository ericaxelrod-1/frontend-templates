import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { lastValueFrom } from 'rxjs';
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
  `,
})
export class LoginPage {
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly failureReason = signal<string | null>(null);

  private readonly credentials = signal({ username: '', password: '' });

  /**
   * `username` and `password` are required because `LoginRequestDto` declares
   * `@IsString() @MinLength(1)` on both (`backend/src/auth/login-request.dto.ts`),
   * and the global `ValidationPipe` is configured with `forbidNonWhitelisted`, so
   * an empty field is a `400` and not a wrong-password answer. The client check
   * exists to say so locally; the server check is the one that counts.
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
      const { username, password } = this.credentials();
      await lastValueFrom(this.session.login({ username, password }));
      // `/profile`, matching the shell's `/` redirect: it is the one route every
      // signed-in user can act on, so an administrator lands there and is one click
      // from the Users page and a member is not shown a page they cannot use.
      await this.router.navigateByUrl('/profile');
    } catch (error) {
      // Nothing is swallowed: the reason reaches the page, and the cause is on
      // the wire in the network tab.
      this.failureReason.set(describeLoginFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
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