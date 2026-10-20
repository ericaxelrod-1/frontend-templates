import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';

/**
 * Legal documents placeholder: Privacy Policy and Terms of Service.
 *
 * ## WHY THIS IS AN EXPLICIT PLACEHOLDER AND NOT A SAMPLE POLICY
 *
 * A template cannot author the operator's legal commitments. The legal terms and
 * privacy disclosure of an installation depend on who operates it, their legal
 * jurisdiction, the specific business purpose, data processing agreements with
 * subprocessors, and the statutory requirements that apply to their organisation.
 *
 * A sample privacy policy or boilerplate terms that look finished would create the
 * illusion of legal compliance where none exists (AGENTS.md §2.1: a thing that
 * looks finished and is not is worse than absence). This page states plainly that
 * the documents must be replaced by the deploying operator before the system goes
 * live in production, and specifies the exact regulatory and operational topics
 * each document must address.
 */
@Component({
  selector: 'app-legal-page',
  standalone: true,
  imports: [MatCardModule, MatDividerModule, MatTabsModule],
  templateUrl: './legal-page.html',
  styles: `
    :host {
      display: block;
      max-width: 56rem;
      margin: 0 auto;
      padding: 1rem;
    }

    .legal-notice {
      border-left: 4px solid var(--mat-sys-error);
      background-color: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      padding: 1rem;
      margin-bottom: 1.5rem;
      border-radius: 4px;
    }

    .legal-notice__title {
      font: var(--mat-sys-title-medium);
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .legal-notice__body {
      font: var(--mat-sys-body-medium);
      margin: 0;
    }

    .legal-card {
      margin-top: 1rem;
    }

    .section-title {
      font: var(--mat-sys-title-small);
      font-weight: 600;
      margin-top: 1rem;
      margin-bottom: 0.5rem;
    }

    .legal-list {
      margin: 0.5rem 0 1rem 1.5rem;
      padding: 0;
      font: var(--mat-sys-body-medium);
      line-height: 1.6;
    }

    .legal-list li {
      margin-bottom: 0.5rem;
    }

    .legal-paragraph {
      font: var(--mat-sys-body-medium);
      line-height: 1.6;
      margin-bottom: 1rem;
    }
  `,
})
export class LegalPage {}
