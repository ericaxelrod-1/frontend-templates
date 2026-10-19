import { Component, input } from '@angular/core';

/**
 * The failures a surface has to state, in the words that detected them chose.
 *
 * It is in `shared/` because two features render it: the public consent
 * widget and the consent form inside the profile settings. The alternative is
 * the same block written twice, which is what AGENTS.md §F5 forbids — and worse
 * than the duplication, the two copies would drift, so one surface would end
 * up saying "something went wrong" while the other says what actually failed.
 *
 * ## The wording belongs to the code that detected the failure
 *
 * This component renders the sentences it is given and decides nothing about
 * them. A failure is detected where it happens — in the consent gate — and the
 * sentence that goes with it is written there, next to the reason it is
 * needed. A surface that invented its own wording for a failure it did not
 * detect would be a second mechanism for the same concern (§2.4).
 *
 * ## Why it is an alert
 *
 * `role="alert"` on the region, not on each line: the whole region is one
 * piece of news for the person reading it, and a screen reader should announce
 * it once. The region is `aria-live` by virtue of the role, so a failure that
 * arrives after the page has loaded — which is the normal case, because the
 * catalogue is fetched — reaches the person who is already on the page.
 */
@Component({
  selector: 'app-failure-notice',
  standalone: true,
  templateUrl: './failure-notice.html',
  styles: `
    .failure-notice {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
      font-weight: 500;
    }

    .failure-notice p {
      margin: 0 0 0.5rem;
    }

    .failure-notice p:last-child {
      margin-bottom: 0;
    }
  `,
})
export class FailureNotice {
  /** The sentences to state. */
  readonly messages = input.required<readonly string[]>();
}
