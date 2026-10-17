import { Component, input } from '@angular/core';

/**
 * One association cell in the Users table: a list of names, or the reason there
 * is no list.
 *
 * It exists because that cell appears twice — roles and groups — and the two
 * blocks are identical apart from the data. Copying the block is what §F5 forbids;
 * this is the extraction.
 *
 * `blocked` is the honest third state. An empty list and an unreadable table are
 * different facts: "this user holds no roles" and "this role cannot see the
 * assignment table" must not render the same thing, and the second one is what an
 * `app_member` sees (`user_roles` is admin-only at the table level).
 */
@Component({
  selector: 'app-name-list',
  standalone: true,
  template: `
    @if (blocked()) {
      <span class="blocked">not readable for this role</span>
    } @else {
      @for (name of names(); track name) {
        <span class="item">{{ name }}</span>
      } @empty {
        <span class="empty">none returned</span>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      align-items: baseline;
    }

    .item {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      border-radius: 999px;
      padding: 0.1rem 0.6rem;
      font: var(--mat-sys-label-medium);
    }

    .empty,
    .blocked {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class NameList {
  readonly names = input.required<readonly string[]>();
  readonly blocked = input(false);
}