import type { PoolClient } from 'pg';
import { consentConfigMaterializer } from './consent-config-materializer.js';
import { securityAlertsMaterializer } from './security-alert-materializer.js';

/**
 * What one materialisation pass did.
 *
 * `scanned` is the number of source rows the window covered and `created` the number
 * of notification rows that were NOT already there. The gap between them is not an
 * error and not a duplicate — it is the overlap and the dismissals doing their jobs,
 * and a report that conflated the two would make an idle pass indistinguishable from a
 * broken one (§2.3). Both are logged every run, including the all-zero pass.
 */
export type MaterializeSummary = {
  readonly source: string;
  readonly scanned: number;
  readonly created: number;
};

/**
 * The lower bound of one pass, already resolved to an instant.
 *
 * ## A FLOOR AND NO CEILING, and the two reasons
 *
 * **The upper bound is the statement's own snapshot.** The read and the insert are
 * one statement, so every row the pass counted is a row it could also have written;
 * an explicit ceiling would add a parameter and constrain nothing. It would also
 * introduce a comparison between two clocks — `now()` in PostgreSQL against
 * `Date.now()` in Node — and that comparison is a real flake, not a theoretical one:
 * a source row written between the sampler and the statement carries a `created_at`
 * a few hundred microseconds ABOVE the ceiling and is skipped by a pass that could
 * have seen it. Measured as an intermittent `scanned: 0` on a row that had just been
 * inserted.
 *
 * **The bound that matters is still real.** There IS an implicit ceiling: a source
 * row whose `created_at` is in the FUTURE is still picked up (there is nothing to
 * exclude it), and the next pass's watermark is then that future instant, so
 * `floor = watermark - overlap` jumps forward past every genuine row in between. That
 * is the hazard a ceiling would have closed, and it is not worth a cross-clock
 * comparison to close: it needs a source that writes a future `created_at`, which no
 * table in this repository does because every one of them defaults `created_at` to
 * `now()`. It is recorded here rather than left to be rediscovered, and the fix when
 * a future-writing source appears is a ceiling read from `now()` inside the statement
 * — not from the application clock.
 *
 * It is a VALUE rather than a clock read inside the work, for the reason
 * `breaker-state.ts` exists: a test that has to wait for wall time to cross a window
 * boundary is a test that will pass on the wrong side of it.
 */
export type MaterializeWindow = {
  /** Inclusive. Everything the source recorded at or after this instant is in scope. */
  readonly floorAt: Date;
};

/**
 * One source, and the function that renders it.
 *
 * ## The window is NOT the materializer's, and that is the point
 *
 * The brief each materialiser is given is "determines its window, reads its source
 * table, inserts rows, must not resurrect a dismissal". This interface splits that
 * after the first step: the window is computed ONCE, by the runner, and handed in.
 *
 * A cursor implemented per source is N copies of one piece of arithmetic, and copies
 * drift — one that forgets the overlap loses backdated records while the others do
 * not, and nothing reports which. There is exactly one watermark query here
 * ({@link WATERMARK_SQL}) and exactly one place that subtracts the overlap from it.
 *
 * ## The fourth step is the one that is easy to get wrong
 *
 * `materialize` must treat a row that already exists as PRESENT AND SATISFIED, never
 * as something to re-insert. The mechanism is `ON CONFLICT (source, source_ref,
 * user_id) DO NOTHING` against the `UNIQUE NULLS NOT DISTINCT` index in `0027`, and
 * the reason it is stated as a contract rather than left to each implementation is
 * that getting it wrong is invisible: a resurrected dismissal looks exactly like a
 * working materialiser that simply found a new source row.
 * `test/unit/notifications/materializer.spec.ts` proves the behaviour against a real
 * database rather than reading these words.
 */
export type Materializer = {
  /** The `admin_notifications.source` value this materialiser writes. */
  readonly source: string;
  /**
   * Read the source at or after `floorAt` and write a notification for each row not
   * already rendered.
   */
  materialize(client: PoolClient, window: MaterializeWindow, expirySeconds: number): Promise<MaterializeSummary>;
}

/**
 * The newest notification this source has ever written, or `undefined` if it has
 * written none.
 *
 * ## Why the ORDER is `created_at DESC, id DESC` and not `id DESC`
 *
 * `id` is `uuidv7()` and therefore already sorted by minting time (§B1), which makes
 * it the obvious watermark column and — measured against the alternative — the wrong
 * one here, for two reasons that only appear together:
 *
 *   1. **A notification is minted AFTER the source row it renders.** Inserting it is
 *      the last thing the pass does, so `id` order is *insertion* order, which is
 *      source order only in the trivial case of one row per pass. Take the newest
 *      notification's `created_at` as the mark and, on a pass that rendered ten rows
 *      an hour apart, you have taken whichever of the ten the planner emitted last —
 *      which is not the newest of them.
 *   2. **Within one pass `id` order is arbitrary** with respect to the source's own
 *      timestamps, so on a normal pass the mark lands near the bottom of the window
 *      and the next pass re-reads most of it. Nothing is lost (`ON CONFLICT DO
 *      NOTHING`), but the overlap stops being the *only* thing re-read, which is the
 *      property it exists to keep narrow.
 *
 * `created_at DESC` picks the newest rendered source row, and `id DESC` breaks the
 * tie deterministically — two rows stamped in the same millisecond have no order, and
 * a watermark that varies run to run makes every run's window vary with it. `id`
 * still earns its place: it is the tiebreaker, it is the primary key, and it is what
 * makes the covering index below a right-hand-edge lookup rather than a sort.
 *
 * ## The recorded limit, because the overlap cannot fix everything
 *
 * The overlap re-reads `lookbackSeconds` behind the mark, so a source row that
 * arrives backdated by LESS than the overlap is picked up on the next pass and a row
 * backdated by MORE is not. That ceiling is the price of not scanning the source in
 * full every run, and it is why the lookback is measured in HOURS by default: the
 * only rows in this repository that can be backdated are seeded fixtures, and the
 * alternative — no watermark at all — silently drops every one of them, silently and
 * permanently, which is the failure this whole mechanism is the answer to.
 *
 * ## Why `id` cannot be the watermark even though it is time-ordered
 *
 * It could only be, by reading the 48-bit millisecond prefix out of the uuid and
 * doing interval arithmetic on it — and the value it would carry is `created_at`
 * anyway, because the mark has to mean "when did this pass see the source", which is
 * a time and not a mint order. Taking a `uuid` apart to recover a timestamp the row
 * already stores is the sort of cleverness that is correct once and unreadable twice.
 */
export const WATERMARK_SQL = `
  SELECT n.created_at AS watermark_at
  FROM public.admin_notifications n
  WHERE n.source = $1
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT 1
`;

/**
 * The one registration point.
 *
 * An object literal rather than an array of pairs, a decorator, a DI token or a
 * discovery scan: a source that is not a key here cannot be run by anything, because
 * the runner iterates {@link REGISTERED_SOURCES} and there is no other loop in
 * `src/notifications/`. Adding a source is adding a key, which is a diff.
 *
 * `Object.freeze` because the runner holds the list for the life of the process and a
 * mutable registry is a registry a test can mutate between two assertions.
 */
const MATERIALIZERS: Readonly<Record<string, Materializer>> = Object.freeze({
  [securityAlertsMaterializer.source]: securityAlertsMaterializer,
  [consentConfigMaterializer.source]: consentConfigMaterializer,
});

/** Every source that will be materialised, in a stable order. */
export const REGISTERED_SOURCES: readonly string[] = Object.freeze(Object.keys(MATERIALIZERS));

/**
 * The materialiser for `source`, or a thrown error naming it.
 *
 * It throws rather than returning `undefined` because the only caller is the runner,
 * which iterates the keys it cannot get wrong, so reaching this with an unknown name
 * means the two were changed apart — and a silent "skip this source" there is a
 * materialiser that quietly stopped running (§2.3).
 */
export function materializerFor(source: string): Materializer {
  const materializer = MATERIALIZERS[source];
  if (materializer === undefined) {
    throw new Error(
      `no materializer is registered for source '${source}'. Registered: ${REGISTERED_SOURCES.join(', ')}. ` +
        'Add it to MATERIALIZERS in src/notifications/materializer.ts — a source that is not registered ' +
        'cannot run, which is the point.',
    );
  }
  return materializer;
}