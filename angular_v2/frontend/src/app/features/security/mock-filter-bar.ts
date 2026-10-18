import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

/**
 * Shared control for the `is_mock` display filter across the five security pages.
 *
 * Synthetic seed rows (`is_mock = true`) are excluded by default so an operator
 * never mistakes a seed fixture for a live attack. Turning the toggle on adds a
 * visible `"including test rows"` filter chip so the broadened scope is explicit.
 */
@Component({
  selector: 'app-mock-filter-bar',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="mock-bar" role="region" aria-label="Synthetic test row filter">
      <div class="mock-bar__status">
        @if (includeMock()) {
          <span class="mock-bar__chip">including test rows</span>
          <span class="mock-bar__hint">
            Synthetic seed rows (<code>is_mock = true</code>) are shown alongside live telemetry and
            badged as synthetic.
          </span>
        } @else {
          <span class="mock-bar__hint">
            Showing live telemetry only; synthetic test rows (<code>is_mock = true</code>) are
            hidden by default.
          </span>
        }
      </div>

      <button
        matButton="outlined"
        type="button"
        [attr.aria-pressed]="includeMock()"
        (click)="toggle()"
      >
        @if (includeMock()) {
          Hide test rows
        } @else {
          Include test rows
        }
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 0.75rem;
    }

    .mock-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
      background: var(--mat-sys-surface-container-low);
    }

    .mock-bar__status {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }

    .mock-bar__chip {
      display: inline-block;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-medium);
      font-weight: 600;
    }

    .mock-bar__hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  `,
})
export class MockFilterBar {
  readonly includeMock = input(false);
  readonly includeMockChange = output<boolean>();

  protected toggle(): void {
    this.includeMockChange.emit(!this.includeMock());
  }
}
