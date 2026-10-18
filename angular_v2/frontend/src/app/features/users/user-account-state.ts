import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { CodeLabelPipe } from '../../shared/code-label';
import type { UserAccountStateRecord } from './user-account-state-record';

/**
 * `users.deletion_reason`, closed by `users_deletion_reason_check` to
 * `('rtbf', 'inactive', 'admin')` in `0009_anonymisation.sql`.
 *
 * The three are three different conversations with the person whose data it was: a
 * right to be forgotten, an inactivity threshold, and an administrator's decision.
 * Rendering the raw code would give an operator only the third one.
 */
const DELETION_REASON_LABELS: Readonly<Record<string, string>> = {
  rtbf: 'erased at the member\'s request',
  inactive: 'erased after inactivity',
  admin: 'erased by an administrator',
};

/**
 * `users.disabled_reason`, closed by `users_disabled_reason_check` in
 * `0023_user_profile_and_disable.sql` to
 * `('admin', 'security', 'compliance', 'user_request')`.
 */
const DISABLED_REASON_LABELS: Readonly<Record<string, string>> = {
  admin: 'administrator action',
  security: 'automated security block',
  compliance: 'statutory obligation',
  user_request: 'requested by the member',
};

/**
 * The account-state cell: what has been done to this account, and when.
 *
 * It is on the Users page because it is EVIDENCE, not decoration. `deleted_at` and
 * `email_anonymized` are how an operator confirms an erasure was honoured rather
 * than merely requested, and the disable columns are how a temporary suspension is
 * told apart from a permanent one.
 *
 * ## Permanent vs temporary is the whole point of `disabled_until`
 *
 * A NULL `disabled_until` does not mean "no expiry known". It means the disable
 * does not expire: nothing sweeps it (`0023`, on `disabled_until` — "a column with
 * a timestamp in it is a record of when a suspension was meant to end, and a
 * sweeper that acts on it is application work this file does not pretend to do").
 * So the two cases are rendered as two different sentences, and "permanent" is never
 * inferred by a caller that has not been told the account is disabled at all.
 *
 * ## `disabled_by` is a pointer, and it is shown as one
 *
 * It is the administrator row that made the decision, `ON DELETE SET NULL` — a
 * pointer AT a person, not a row owned by the disabled account. A NULL actor is
 * legal only when `disabled_reason` explains the decision, so "who" is rendered as
 * unknown-and-why rather than omitted.
 */
@Component({
  selector: 'app-user-account-state',
  standalone: true,
  imports: [CodeLabelPipe, DatePipe],
  templateUrl: './user-account-state.html',
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      align-items: flex-start;
    }

    .entry {
      display: block;
      max-width: 28rem;
    }

    .entry__headline {
      font: var(--mat-sys-label-large);
    }

    .entry__detail {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .none,
    .blocked {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class UserAccountState {
  readonly record = input.required<UserAccountStateRecord>();

  /**
   * True when the signed-in role's grant does not include these seven columns, so
   * nothing here was asked for and nothing here can be answered. It is passed in
   * rather than derived from absent keys, because "this account was never disabled"
   * and "these columns are not readable for you" would otherwise render
   * identically — the same rule `NameList` follows for roles and groups.
   */
  readonly blocked = input(false);

  /** The two vocabularies, exposed for the `codeLabel` pipe. */
  protected readonly deletionReasons = DELETION_REASON_LABELS;
  protected readonly disabledReasons = DISABLED_REASON_LABELS;

  /**
   * The instants themselves rather than booleans, so `@if (erasedAt(); as when)`
   * narrows to the string and the template can render it. A boolean would narrow to
   * `true` and leave the date unreadable from there.
   */
  protected readonly erasedAt = computed(() => this.record().deletedAt);

  protected readonly disabledAt = computed(() => this.record().disabledAt);

  /**
   * `disabled_until` decides the word, not the presence of the value: a NULL expiry
   * on a disabled account is a permanent disable, and a temporary one says when it
   * ends. It is computed here rather than tested in the template because the two
   * facts it combines — the account is disabled at all, and the disable carries an
   * end — have to hold together before "until" is a true sentence.
   */
  protected readonly temporary = computed(() => this.record().disabledUntil !== null);

  protected readonly disabledUntil = computed(() => this.record().disabledUntil);
}