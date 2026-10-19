import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { ConsentGate } from '../../core/consent/consent-gate.service';
import type { ConsentPurpose } from '../../core/consent/consent.types';
import { FailureNotice } from '../../shared/failure-notice';

export interface ProfileConsentItemViewModel {
  readonly purpose: ConsentPurpose;
  readonly isGranted: boolean;
  readonly needsReprompt: boolean;
  readonly recordedAt: string | null;
  readonly mechanism: string | null;
}

/**
 * Consent management inside user profile settings (`/profile`).
 *
 * ## Tone and structure
 *
 * Matches the existing profile section cards: explains what the database
 * holds, cites the legal basis (GDPR Art. 6), and provides equal-effort
 * controls for granting and withdrawing consent.
 *
 * ## Re-prompting
 *
 * When `consent_purposes.policy_version` has been bumped past the version
 * recorded in the member's last decision, a notice highlights that the policy
 * was updated and prompts for explicit re-confirmation.
 */
@Component({
  selector: 'app-profile-consent-form',
  standalone: true,
  imports: [FailureNotice, MatButtonModule, MatCardModule, MatDividerModule],
  templateUrl: './consent-form.html',
  styles: `
    .consent-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .purpose-item {
      padding: 1rem;
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

    .purpose-meta {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 0.5rem;
    }

    .reprompt-notice {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
      font-weight: 500;
      margin: 0.25rem 0 0.5rem;
    }

    .purpose-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .global-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .saved-status {
      color: var(--mat-sys-primary);
      font: var(--mat-sys-body-small);
      margin-top: 0.5rem;
    }

    .write-failure {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
      font-weight: 500;
      margin-top: 0.5rem;
    }
  `,
})
export class ProfileConsentForm {
  private readonly gate = inject(ConsentGate);

  protected readonly lastSavedAt = signal<string | null>(null);

  /**
   * The last failed write, surfaced to the person who made the decision.
   *
   * Read from the gate rather than caught here, because the write is issued by
   * the gate and this form is only where the outcome is shown.
   */
  protected readonly writeFailure = this.gate.writeFailure;

  /**
   * The failures about the state of this surface, in the gate's words.
   *
   * Three of them, and they are three different things:
   *
   * - the catalogue of purposes could not be loaded, so this form has no
   *   purposes to show and nothing to grant;
   * - the browser's copy of the decisions could not be read or written, so a
   *   decision made here may not be remembered on this device;
   * - the server's records could not be read, so what is shown here is the
   *   browser's copy and not the account's own history.
   *
   * The write failure is not among them: it is the outcome of the action the
   * person has just taken, so it is shown next to the buttons that caused it.
   */
  protected readonly failureMessages = computed<readonly string[]>(() =>
    [
      this.gate.configFailure(),
      this.gate.storageFailure(),
      this.gate.serverReadFailure(),
    ].filter((message): message is string => message !== null),
  );

  /**
   * Whether the catalogue of purposes could not be loaded.
   *
   * When it could not, the form has nothing to show and nothing to grant:
   * "Grant all" would grant nothing. So the buttons are not rendered at all
   * rather than rendered as buttons that do nothing.
   */
  protected readonly configFailure = this.gate.configFailure;

  protected readonly items = computed<readonly ProfileConsentItemViewModel[]>(() => {
    const purposes = this.gate.consentRequiredPurposes();
    const decisions = this.gate.decisions();
    const repromptKeys = new Set(this.gate.repromptPurposes().map((p) => p.key));

    return purposes.map((purpose) => {
      const decision = decisions.get(purpose.key);
      const isGranted = decision?.granted ?? false;
      const needsReprompt = repromptKeys.has(purpose.key);

      return {
        purpose,
        isGranted,
        needsReprompt,
        recordedAt: decision?.recordedAt ?? null,
        mechanism: decision?.mechanism ?? null,
      };
    });
  });

  protected setChoice(purposeKey: string, granted: boolean): void {
    this.gate.setDecision(purposeKey, granted, 'profile_settings');
    this.lastSavedAt.set(new Date().toLocaleTimeString());
  }

  protected grantAll(): void {
    const list = this.gate.consentRequiredPurposes().map((p) => ({
      purposeKey: p.key,
      granted: true,
    }));
    this.gate.setDecisions(list, 'profile_settings_grant_all');
    this.lastSavedAt.set(new Date().toLocaleTimeString());
  }

  protected withdrawAll(): void {
    const list = this.gate.consentRequiredPurposes().map((p) => ({
      purposeKey: p.key,
      granted: false,
    }));
    this.gate.setDecisions(list, 'profile_settings_withdraw_all');
    this.lastSavedAt.set(new Date().toLocaleTimeString());
  }
}
