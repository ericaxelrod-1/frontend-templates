import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Router, RouterLink } from '@angular/router';

/**
 * The `**` route's page: a real answer to a URL the application cannot map.
 *
 * It names the path that was asked for, which is the one piece of information a
 * person who landed here actually wants, and it offers the destinations that do
 * exist rather than redirecting them somewhere on the assumption that they meant
 * something else (AGENTS.md §F7: no silent `redirectTo: '/'`).
 *
 * `router.url` is read once, at construction. The component is created by the
 * navigation that brought it here, so the value is the URL being reported; it
 * needs no signal because it does not change while the page is on screen.
 */
@Component({
  selector: 'app-not-found-page',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, RouterLink],
  template: `
    <main class="page">
      <mat-card class="card">
        <mat-card-header>
          <mat-card-title>Page not found</mat-card-title>
          <mat-card-subtitle>Nothing is mapped to <code>{{ attemptedPath }}</code>.</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <p>These are the pages that exist:</p>
          <a matButton="filled" routerLink="/users">Users</a>
          <a matButton routerLink="/login">Sign in</a>
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

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  `,
})
export class NotFoundPage {
  protected readonly attemptedPath = inject(Router).url;
}