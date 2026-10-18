import { Pipe, type PipeTransform } from '@angular/core';

/**
 * The human label for one member of a closed vocabulary — `users.deletion_reason`,
 * `users.disabled_reason`, `users.geo_source`, `login_attempts.status`,
 * `login_attempts.attempt_kind` — and a loud answer for one that is not in the
 * table.
 *
 * It is a pure pipe rather than a component method because AGENTS.md §F5 forbids
 * method calls in template bindings: a method re-evaluates on every change
 * detection pass and a pipe is memoised on its arguments. The dictionaries are
 * passed as the second argument rather than imported from here so that each caller
 * owns the vocabulary it is rendering, and so the pipe has no opinion about any
 * particular column.
 *
 * ## Why the vocabulary is written down on this side at all
 *
 * Those columns are all `CHECK`-constrained in the database and the GENERATED types
 * say only `string` — PostgREST emits the column, not the constraint (see
 * `components['schemas']['users']`). So the vocabulary has to be restated here, and
 * it is restated as a plain record so a column renamed or a constraint widened
 * fails the typecheck rather than arriving as an empty cell.
 *
 * ## An unrecognised code is shown, not swallowed
 *
 * A value that is not in the record comes back as `unrecognised code "<value>"`,
 * never as `null` and never as an empty span. A fourth `deletion_reason` added by a
 * migration and not to this table has to be visible on the page: a cell that quietly
 * shows nothing reads as "no reason recorded", which is a different and wrong fact
 * (AGENTS.md §2.3 — fail loudly, never silently).
 *
 * `null` and `undefined` are the ABSENT case, which is different from
 * unrecognised, and they are the only inputs that return `null`. Keeping the two
 * distinguishable is the whole reason this is a function with two outcomes rather
 * than a lookup that returns `undefined` for both.
 */
@Pipe({ name: 'codeLabel' })
export class CodeLabelPipe implements PipeTransform {
  transform(
    value: string | null | undefined,
    labels: Readonly<Record<string, string>>,
  ): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return labels[value] ?? `unrecognised code "${value}"`;
  }
}