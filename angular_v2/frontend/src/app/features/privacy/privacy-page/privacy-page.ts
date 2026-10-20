import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { Session } from '../../../core/auth/session.service';
import type { ProfileMe } from '../../profile/profile-me';
import { PrivacyApi } from '../privacy-api.service';
import type { EraseResponse } from '../privacy.types';

/**
 * The privacy dashboard and account erasure surface.
 *
 * ## THE QUESTION A PERSON NEEDS ANSWERED
 *
 * "What data is held about me, what happens if I ask to be forgotten, and how do I
 * exercise that right?"
 *
 * ## HONESTY ABOUT ERASURE (RIGHT TO BE FORGOTTEN)
 *
 * Erasure is not a magical vanishing of all database rows. The tree enforces strict
 * statutory separation (11 CCR §7111 and 11 CCR §7101(b)) as detailed in
 * `backend/src/privacy/erasure.service.ts` and `docs/security.md`:
 *
 * 1. What is ERASED immediately:
 *    - Personal email is replaced with a cryptographic HMAC tombstone address.
 *    - Username is replaced with an HMAC tombstone local part.
 *    - Password hash is replaced with a random CSPRNG bcrypt hash.
 *    - All active refresh tokens and sessions are revoked.
 *    - All group memberships and role assignments are revoked.
 *
 * 2. What is RETAINED and why:
 *    - Login attempts telemetry is retained under 11 CCR §7111 to investigate security
 *      incidents, but pseudonymised under the tombstone username.
 *    - Statutory compliance audits (`privacy_request_audits`) are retained under
 *      11 CCR §7101(b) as proof of compliance, pseudonymised via keyed HMAC pepper.
 *    - Soft-deleted tombstones are retained during the retention window before being
 *      purged by the automated purge sweeper.
 */
@Component({
  selector: 'app-privacy-page',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: './privacy-page.html',
  styles: `
    :host {
      display: block;
      max-width: 56rem;
      margin: 0 auto;
      padding: 1rem;
    }

    .privacy-card {
      margin-bottom: 1.5rem;
    }

    .card-header-icon {
      margin-right: 0.5rem;
      vertical-align: middle;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .info-label {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }

    .info-value {
      font: var(--mat-sys-body-large);
      font-weight: 500;
    }

    .substance-columns {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      gap: 1.5rem;
      margin-top: 1rem;
    }

    .substance-column {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      padding: 1rem;
    }

    .substance-column--erased {
      border-top: 4px solid var(--mat-sys-primary);
    }

    .substance-column--retained {
      border-top: 4px solid var(--mat-sys-tertiary);
    }

    .substance-title {
      font: var(--mat-sys-title-medium);
      font-weight: 600;
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .substance-list {
      margin: 0;
      padding-left: 1.25rem;
      font: var(--mat-sys-body-medium);
      line-height: 1.5;
    }

    .substance-list li {
      margin-bottom: 0.75rem;
    }

    .erasure-box {
      border: 1px solid var(--mat-sys-error-container);
      background-color: var(--mat-sys-surface-variant);
      border-radius: 8px;
      padding: 1.25rem;
      margin-top: 1rem;
    }

    .erasure-warning {
      color: var(--mat-sys-error);
      font: var(--mat-sys-title-small);
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .erasure-actions {
      display: flex;
      gap: 1rem;
      margin-top: 1rem;
      align-items: center;
    }

    .outcome-box {
      border-left: 4px solid var(--mat-sys-primary);
      background-color: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      padding: 1rem;
      border-radius: 4px;
      margin-top: 1rem;
    }

    .error-box {
      border-left: 4px solid var(--mat-sys-error);
      background-color: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      padding: 1rem;
      border-radius: 4px;
      margin-top: 1rem;
    }
  `,
})
export class PrivacyPage {
  private readonly privacyApi = inject(PrivacyApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  protected readonly profile = signal<ProfileMe | null>(null);
  protected readonly loading = signal(false);
  protected readonly erasing = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly outcome = signal<EraseResponse | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly hasProfile = computed(() => this.profile() !== null);
  protected readonly isErased = computed(() => this.outcome() !== null);

  constructor() {
    this.loadProfile();
  }

  private loadProfile(): void {
    this.loading.set(true);
    this.privacyApi.myPrivacyState().subscribe({
      next: (data) => {
        this.profile.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  protected promptErasure(): void {
    this.confirmOpen.set(true);
    this.error.set(null);
  }

  protected cancelErasure(): void {
    this.confirmOpen.set(false);
  }

  protected executeErasure(): void {
    this.erasing.set(true);
    this.error.set(null);

    this.privacyApi.eraseSelf().subscribe({
      next: (res) => {
        this.erasing.set(false);
        this.confirmOpen.set(false);
        this.outcome.set(res);
      },
      error: (err: unknown) => {
        this.erasing.set(false);
        const msg = err instanceof Error ? err.message : 'Erasure request failed';
        this.error.set(msg);
      },
    });
  }

  protected signOutAfterErasure(): void {
    this.session.logout();
    void this.router.navigateByUrl('/login');
  }
}
