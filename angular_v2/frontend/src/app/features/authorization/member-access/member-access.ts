import { Component, computed, input } from '@angular/core';
import type { MemberScope } from '../authorization-model';

/**
 * A member's effective access, shown as the JOIN of two columns that are kept
 * apart.
 *
 * ## WHY THIS IS ONE COMPONENT AND NOT TWO
 *
 * `AGENTS.md` §F5: extract repeated markup into a component rather than copying a
 * block. The two administration surfaces both show a member's access — the groups
 * surface shows it beside the membership, the roles surface shows it beside the
 * role assignment — and the two copies would drift, which is how one of them ends
 * up implying that a role grants a scope.
 *
 * ## THE TWO COLUMNS ARE SEPARATE ON PURPOSE
 *
 * Scope is RLS and capability is OLS, and they resolve from two different tables
 * through two different mechanisms (`AGENTS.md` §B2, ADR-0023). Nothing in the
 * schema joins them, so nothing here joins them into one sentence either:
 *
 *   * **SCOPE — which rows.** The groups the person is in, and the groups whose
 *     rows those memberships carry (the closure: a membership in a group reaches
 *     its descendants).
 *   * **CAPABILITY — which objects.** The resources and actions the person may
 *     touch, resolved up the role hierarchy from the roles they hold.
 *
 * The join is stated in words above the two columns, because it is the answer and
 * it is NOT stored anywhere: the effective access of a person is the intersection
 * of what they may see and what they may do, computed on the spot from two
 * independent mechanisms. The sentence under the heading says so explicitly,
 * because a panel that showed one list labelled "access" would be claiming a
 * combination the database does not hold.
 *
 * ## A `null` AXIS IS NOT AN EMPTY AXIS
 *
 * `null` means the axis could not be READ (a `403`: the capability axis is
 * admin-only at the table level), and it is rendered as "not readable for this
 * role" — never as an empty list. An empty list would say the person may do
 * nothing, which is a different claim and, for a member, a false one.
 */
@Component({
  selector: 'app-member-access',
  standalone: true,
  templateUrl: './member-access.html',
  styles: `
    .access {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--mat-sys-surface);
    }

    .access__title {
      margin: 0 0 0.25rem;
      font: var(--mat-sys-title-small);
    }

    .access__join {
      margin: 0 0 0.75rem;
      max-width: 52rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .access__axes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
      gap: 0.75rem 1.5rem;
    }

    .axis {
      border-left: 4px solid var(--mat-sys-outline);
      padding-left: 0.75rem;
    }

    .axis--scope {
      border-left-color: var(--mat-sys-primary);
    }

    .axis--capability {
      border-left-color: var(--mat-sys-tertiary);
    }

    .axis__title {
      margin: 0 0 0.35rem;
      font: var(--mat-sys-label-large);
    }

    .axis__label {
      margin: 0.5rem 0 0.15rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }

    .axis__list {
      margin: 0;
      padding-left: 1.1rem;
      font: var(--mat-sys-body-medium);
    }

    .axis__none {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
  `,
})
export class MemberAccess {
  /** The person's name, as the surrounding surface renders it. */
  readonly memberLabel = input.required<string>();

  /** The scope axis, or `null` when it could not be read. */
  readonly scope = input.required<MemberScope | null>();

  /** The capability axis, or `null` when it could not be read. */
  readonly capabilities = input.required<readonly string[] | null>();

  /**
   * The region's accessible name.
   *
   * A `computed` rather than a concatenation in the template: `AGENTS.md` §F5
   * forbids an inline expression in a binding, and this one is a sentence about
   * the region rather than a value read off a row.
   */
  protected readonly ariaLabel = computed(() => `Effective access for ${this.memberLabel()}`);
}
