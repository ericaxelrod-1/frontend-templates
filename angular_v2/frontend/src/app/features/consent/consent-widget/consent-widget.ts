import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { Session } from '../../../core/auth/session.service';
import { ConsentGate } from '../../../core/consent/consent-gate.service';
import type { ConsentPurpose } from '../../../core/consent/consent.types';

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
  imports: [MatButtonModule, MatCardModule, MatDividerModule],
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
    // If the visitor needs to be re-prompted upon landing, open the modal automatically
    if (this.gate.needsReprompt()) {
      this.openModal();
    }
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
