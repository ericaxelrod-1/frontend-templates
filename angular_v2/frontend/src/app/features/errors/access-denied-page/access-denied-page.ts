import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Router } from '@angular/router';
import { Session } from '../../../core/auth/session.service';

/**
 * The page the application sends a browser to when the API refuses a token it
 * presented: `401` on a request that carried one (`auth.interceptor.ts`).
 *
 * It exists because that is a different situation from having never signed in.
 * A first-time visitor is asked for credentials; a visitor whose session was
 * rejected is told the session ended, and the difference is worth a page — a
 * silent bounce to the sign-in form looks like the application forgot them.
 */
@Component({
  selector: 'app-access-denied-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule],
  template: `
    <main class="page">
      <mat-card class="card">
        <mat-card-header>
          <mat-card-title>Access denied</mat-card-title>
          <mat-card-subtitle
            >The API refused the access token this browser was holding. It has been
            discarded.</mat-card-subtitle
          >
        </mat-card-header>
        <mat-card-content>
          <p>
            Sign in again to obtain a new one. If this keeps happening the token may
            have been issued by a different signing secret than the API is
            configured with.
          </p>
          <button matButton="filled" type="button" (click)="signInAgain()">
            Sign in again
          </button>
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styles: `
    .page {
      display: flex;
      justify-content: center;
      padding: 3rem 1rem;
    }

    .card {
      max-width: 34rem;
    }
  `,
})
export class AccessDeniedPage {
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  protected signInAgain(): void {
    this.session.clear();
    void this.router.navigateByUrl('/login');
  }
}