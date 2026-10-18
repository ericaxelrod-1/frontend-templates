import { DatePipe } from '@angular/common';
import { Component, input } from '@angular/core';

/**
 * A `timestamptz` that may be NULL, rendered as the instant it records or as the
 * sentence that says the measurement was never taken.
 *
 * It exists because four columns of the Users table are NULLable and each NULL
 * means something specific, none of which is "zero" or "unknown":
 *
 * - `last_login_at` NULL is "no successful authentication has ever been recorded";
 * - `last_activity_at` NULL is "never observed", and a measurement that was never
 *   taken cannot show an account is dormant (0017 §1);
 * - `email_verified_at` NULL is "the address is not verified" — a timestamp, so a
 *   value answers *when* it was verified and not *whether* it still is;
 * - `geo_updated_at` NULL is "no observation has a date".
 *
 * A bare `{{ row.lastLoginAt | date }}` renders an empty cell for all four, which
 * reads as an empty value rather than an absent measurement — the exact confusion
 * AGENTS.md §2.1 warns about, where something that looks finished is not.
 *
 * `absentLabel` is an input because the sentence is not the component's to invent:
 * "never recorded", "never observed" and "not verified" are three different claims
 * and the caller is the one that knows which column it is rendering.
 *
 * The value is wrapped in `<time datetime>` so a machine reading the page gets the
 * instant rather than the human formatting.
 */
@Component({
  selector: 'app-optional-stamp',
  standalone: true,
  imports: [DatePipe],
  template: `
    @if (value(); as instant) {
      <time [attr.datetime]="instant">{{ instant | date: 'medium' }}</time>
    } @else {
      <span class="absent">{{ absentLabel() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-block;
    }

    .absent {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class OptionalStamp {
  readonly value = input<string | null>(null);
  readonly absentLabel = input('never recorded');
}