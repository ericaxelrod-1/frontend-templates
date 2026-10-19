import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { Session } from '../../../core/auth/session.service';
import { ConsentGate } from '../../../core/consent/consent-gate.service';
import type { ConsentPurpose } from '../../../core/consent/consent.types';
import { FailureNotice } from '../../../shared/failure-notice';

export interface PurposeItemViewModel {
  readonly purpose: ConsentPurpose;
  readonly isGranted: boolean;
}

/**
 * Universal consent widget for public pages.
 *
 * Appears exclusively on public pages for unauthenticated visitors.
 * Reachable anywhere via a persistent floating toggle button.
 *
 * Offers equal-effort granting and withdrawal for every non-essential purpose
 * defined in the catalogue.
 */
@Component({
  selector: 'app-consent-widget',
  standalone: true,
  imports: [FailureNotice, MatButtonModule, MatCardModule, MatDividerModule],
  templateUrl: './consent-widget.html',
  styles: `
    .consent-trigger {
      position: fixed;
      bottom: 1rem;
      left: 1rem;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .consent-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1001;
      padding: 1rem;
    }

    .consent-card {
      max-width: 38rem;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      background: var(--mat-sys-surface);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }

    .purpose-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin: 1rem 0;
    }

    .purpose-item {
      padding: 0.75rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 6px;
      background: var(--mat-sys-surface-container-lowest);
    }

    .purpose-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.25rem;
    }

    .purpose-title {
      font: var(--mat-sys-title-small);
      font-weight: 600;
    }

    .purpose-desc {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 0 0 0.5rem;
    }

    .decision-actions {
      display: flex;
      gap: 0.5rem;
    }

    .global-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .consent-failures {
      position: fixed;
      bottom: 4.5rem;
      left: 1rem;
      z-index: 1000;
      max-width: 24rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-lowest);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
  `,
})
export class ConsentWidget {
  private readonly gate = inject(ConsentGate);
  private readonly session = inject(Session);
  private readonly platformId = inject(PLATFORM_ID);

  /** Whether the detailed preferences modal is open. */
  protected readonly isOpen = signal<boolean>(false);

  /** Local staging map of decisions while the modal is open. */
  protected readonly stagedDecisions = signal<ReadonlyMap<string, boolean>>(new Map());

  /** The widget is only visible in the browser and when NOT authenticated. */
  protected readonly isVisible = computed(() => {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    return !this.session.isAuthenticated();
  });

  /** List of purposes requiring consent. */
  protected readonly purposes = this.gate.consentRequiredPurposes;

  /**
   * The failures this widget has to state.
   *
   * A catalogue that could not be loaded means the widget has no purposes to
   * ask about, and a widget that quietly shows an empty list reads as "you
   * have no choices" — the opposite of the truth. A choice that could not be
   * saved in this browser is the same kind of news: the person made a
   * decision and it is not there any more.
   *
   * The sentences are the gate's, not this component's: the gate is where the
   * failure happened and where the reason for the wording is written down.
   */
  protected readonly failureMessages = computed<readonly string[]>(() =>
    [this.gate.configFailure(), this.gate.storageFailure()].filter(
      (message): message is string => message !== null,
    ),
  );

  /**
   * Whether the catalogue of purposes could not be loaded.
   *
   * When it could not, the widget has nothing to ask about: the list of
   * purposes is empty and "Accept all" would record nothing. So the failure
   * REPLACES the list and the actions rather than sitting above an empty form
   * whose buttons do nothing.
   */
  protected readonly configFailure = this.gate.configFailure;

  /** Purposes paired with their currently displayed grant state. */
  protected readonly purposeItems = computed<readonly PurposeItemViewModel[]>(() => {
    const list = this.purposes();
    const staged = this.stagedDecisions();
    const committed = this.gate.decisions();

    return list.map((purpose) => {
      const stagedVal = staged.get(purpose.key);
      const isGranted =
        stagedVal !== undefined
          ? stagedVal
          : (committed.get(purpose.key)?.granted ?? false);
      return { purpose, isGranted };
    });
  });

  constructor() {
    // THE RE-PROMPT, AND WHY IT IS AN EFFECT AND NOT A CONSTRUCTOR CHECK.
    //
    // This used to be `if (this.gate.needsReprompt()) { this.openModal(); }` in
    // the constructor, and it could never fire — and the cause is worth writing
    // down, because it is not a typo:
    //
    // **A re-prompt is a question about the CATALOGUE, and the catalogue is not
    // there yet when the constructor runs.** The gate fetches it asynchronously
    // (`ensureConfiguration` → `loadConfiguration` → the source), so at
    // construction time `purposes()` is empty, `consentRequiredPurposes()` is
    // empty, `repromptPurposes()` is empty, and `needsReprompt()` is false. The
    // condition becomes true a moment later, when the fetch lands — and nothing
    // was watching it. A one-shot check of a value that does not exist yet is a
    // check that never fires.
    //
    // An effect watches the CONDITION instead of the moment, so it fires when
    // the answer changes: the catalogue arrives, the version is newer than the
    // decision, and the person is asked.
    //
    // **THE THREE GUARDS, and each of them is a failure mode:**
    //
    //   * `isVisible()` — the widget is the ANONYMOUS surface. A signed-in
    //     visitor is asked on the account's own surface, and asking them here
    //     as well would ask the same person the same question twice.
    //   * `isOpen()` — a modal that is already open holds STAGED choices the
    //     visitor has not saved yet. Re-opening it would re-stage from the
    //     committed decisions and silently throw their work away.
    //   * `needsReprompt()` — the rule itself: a purpose the person was never
    //     asked about, or one whose `policy_version` is newer than the version
    //     in their last decision, must be asked about.
    effect(() => {
      if (!this.isVisible()) {
        return;
      }
      if (this.isOpen()) {
        return;
      }
      if (!this.gate.needsReprompt()) {
        return;
      }
      // Untracked, so the effect depends on the CONDITION and not on the
      // decisions the modal reads while staging: a dependency on `decisions()`
      // would make this effect re-run on every decision, which is noise, and
      // `untracked` says so in one word.
      untracked(() => this.openModal());
    });
  }

  protected openModal(): void {
    const current = this.gate.decisions();
    const map = new Map<string, boolean>();
    this.purposes().forEach((p) => {
      map.set(p.key, current.get(p.key)?.granted ?? false);
    });
    this.stagedDecisions.set(map);
    this.isOpen.set(true);
  }

  protected closeModal(): void {
    this.isOpen.set(false);
  }

  protected setStaged(purposeKey: string, granted: boolean): void {
    const next = new Map(this.stagedDecisions());
    next.set(purposeKey, granted);
    this.stagedDecisions.set(next);
  }

  protected acceptAll(): void {
    const list = this.purposes().map((p) => ({ purposeKey: p.key, granted: true }));
    this.gate.setDecisions(list, 'consent_widget_accept_all');
    this.isOpen.set(false);
  }

  protected rejectAll(): void {
    const list = this.purposes().map((p) => ({ purposeKey: p.key, granted: false }));
    this.gate.setDecisions(list, 'consent_widget_reject_all');
    this.isOpen.set(false);
  }

  protected saveChoices(): void {
    const staged = this.stagedDecisions();
    const list: Array<{ purposeKey: string; granted: boolean }> = [];
    staged.forEach((granted, purposeKey) => {
      list.push({ purposeKey, granted });
    });
    this.gate.setDecisions(list, 'consent_widget_save');
    this.isOpen.set(false);
  }
}
