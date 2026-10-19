import { Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { MaterializeSummary, MaterializeWindow, Materializer } from './materializer.js';

/**
 * The `consent_tags` misconfiguration reporter — the `admin_notifications` source
 * `0027` was built for this unit to land on.
 *
 * ## WHAT IT REPORTS
 *
 * A configured tag that cannot do what it says is a MISCONFIGURATION, and a
 * misconfiguration that is stored and never reported is the silent kind. Three
 * reachable shapes:
 *
 *   * an empty or whitespace-only `snippet` — the tag is configured and does
 *     nothing, and `0028` deliberately does **not** `CHECK (length(snippet) > 0)`,
 *     because a CHECK turns it into an opaque `23514` at the INSERT that nobody
 *     sees, which is a refusal where the brief asks for a report;
 *   * a `purposes` entry that is not a string, or names a key that is not in
 *     `consent_purposes`. A jsonb array cannot carry a foreign key, which is
 *     exactly why this source exists;
 *   * a tag attached to no page group — configuration that can never fire, which
 *     reads as configured and behaves as disabled.
 *
 * A `purposes` that is not an ARRAY at all is deliberately NOT one of them:
 * `0028` puts `jsonb_typeof(purposes) = 'array'` in a CHECK, so the value cannot
 * be stored, and the alternative is worth refusing. `jsonb_array_elements` on a
 * scalar raises `cannot extract elements from a scalar` — which would take down
 * the whole materialisation pass, every other source's notifications with it, and
 * report a crash where the operator asked for a diagnosis. A CHECK refuses one
 * row at the INSERT; a reporter that raises refuses the report.
 *
 * The third malformation the unit's brief names — a tag naming a page group that
 * does not exist — is **structurally impossible** here: `consent_tag_groups.group_id`
 * is a real foreign key and the INSERT fails with `23503` naming the table. There
 * is deliberately no check for it, because a check that cannot fail is a
 * liability rather than a control (§B8).
 *
 * ## WHY NOTHING HAPPENS AT BOOT
 *
 * This is the shape that satisfies "a configured tag that is malformed must never
 * block a boot" in the strongest way available: **there is no boot-time read at
 * all.** No provider, no `onApplicationBootstrap`, no query before the first
 * request is served — so there is no code path by which a misconfiguration could
 * delay or fail a start, and no fork has to think about whether its analytics
 * configuration is loadable. The report is produced by the job that publishes it,
 * on its first tick (`NOTIFICATIONS_MATERIALIZE_INTERVAL_SECONDS`, 300 s by
 * default), and by then the process has already booted and served traffic.
 *
 * The cost is stated rather than hidden: an operator learns about a broken tag
 * within one interval rather than at boot. The alternative — reading the
 * catalogue at startup — is a second mechanism for one question, and it is the
 * mechanism that could refuse to start the application.
 *
 * ## WHY THE SAME STATEMENT LOGS AND INSERTS
 *
 * §2.4. One pass reads the tags, decides which are malformed, writes one
 * notification per malformed tag and returns the problem list, so "what was
 * logged" and "what was published" cannot disagree — and a report that reached
 * stdout but not the panel (or the reverse) is not a shape this statement can
 * take. `problems` is built in a `read` CTE and consumed by both the `inserted`
 * CTE and the returned summary row.
 *
 * ## IDEMPOTENCE — the property `JobRunner` requires of every job body
 *
 * `ON CONFLICT (source, source_ref, user_id) DO NOTHING` against
 * `UNIQUE NULLS NOT DISTINCT (source, source_ref, user_id)`, for the reason
 * `security-alert-materializer.ts` sets out in full. Here it additionally means a
 * tag that is broken, fixed and broken again is reported again only if its
 * `updated_at` moved — which it does, because `0028` derives that column from a
 * trigger, so an edit is what re-arms the window and nothing else is.
 *
 * ## THE WINDOW COLUMN IS `updated_at`
 *
 * A misconfiguration is a property of the CURRENT configuration, so the window
 * has to be a column that changes when the configuration changes. `created_at`
 * would report a tag once and then never again, and a tag fixed and re-broken
 * would stay silent forever.
 */
export const CONSENT_CONFIG_MATERIALIZE_SQL = `
  WITH bounds AS (
    SELECT $2::timestamptz AS floor_at, now() AS ceiling_at
  ),
  read AS (
    SELECT t.id,
           t.key,
           t.purposes,
           t.enabled,
           t.updated_at,
           -- ARRAY_REMOVE(..., NULL) drops every CASE that matched nothing, which is
           -- how one pass produces a list of prose problems instead of five
           -- booleans the caller has to interpret in a second place.
           array_remove(ARRAY[
             CASE WHEN btrim(t.snippet) = ''
                  THEN 'the snippet is empty, so the tag is configured and does nothing'
             END,
             CASE WHEN jsonb_typeof(t.purposes) = 'array'
                       AND jsonb_array_length(t.purposes) = 0
                  THEN 'the tag names no purpose, so it gates nothing'
             END,
             CASE WHEN jsonb_typeof(t.purposes) = 'array'
                       AND EXISTS (
                             SELECT 1 FROM jsonb_array_elements(t.purposes) e
                              WHERE jsonb_typeof(e) <> 'string'
                           )
                  THEN 'a purpose entry is not a string'
             END,
             CASE WHEN jsonb_typeof(t.purposes) = 'array'
                       AND EXISTS (
                             SELECT 1 FROM jsonb_array_elements(t.purposes) e
                              WHERE jsonb_typeof(e) = 'string'
                                AND NOT EXISTS (
                                      SELECT 1 FROM public.consent_purposes p
                                       WHERE p.key = e #>> '{}'
                                    )
                           )
                  THEN 'no consent_purposes row has key '
                       || coalesce((
                            SELECT string_agg(e #>> '{}', ', ')
                              FROM jsonb_array_elements(t.purposes) e
                             WHERE jsonb_typeof(e) = 'string'
                               AND NOT EXISTS (
                                     SELECT 1 FROM public.consent_purposes p
                                      WHERE p.key = e #>> '{}'
                                   )
                          ), '')
             END,
             CASE WHEN NOT EXISTS (
                             SELECT 1 FROM public.consent_tag_groups tg WHERE tg.tag_id = t.id
                          )
                  THEN 'the tag is attached to no page group, so it can never fire'
             END
           ], NULL) AS problems
      FROM public.consent_tags t, bounds b
     WHERE t.updated_at >= b.floor_at
       AND t.updated_at <= b.ceiling_at
  ),
  malformed AS (
    SELECT r.* FROM read r WHERE cardinality(r.problems) > 0
  ),
  inserted AS (
    INSERT INTO public.admin_notifications (
      source, kind, severity, title, message, data, source_ref,
      audience, user_id, is_mock, created_at, updated_at, expires_at
    )
    SELECT $1,
           'consent_tag_misconfigured',
           -- HIGH and not the table default: a tag that is live and wrong is a
           -- compliance defect, and a misconfiguration nobody triages is the
           -- failure mode this whole report exists to prevent.
           'high',
           'consent tag "' || m.key || '" is misconfigured',
           array_to_string(m.problems, '; '),
           jsonb_build_object(
             'tag_key', m.key,
             'tag_id', m.id,
             'purposes', m.purposes,
             'enabled', m.enabled,
             'problems', to_jsonb(m.problems)
           ),
           m.id::text,
-- Administrators only, and NOT 'all' with a NULL user: a misconfigured
            -- third-party snippet is not something to publish to every authenticated
            -- member, and the notifications table's addressing CHECK is what keeps
            -- the two apart.
           'administrators',
           NULL,
           false,
           m.updated_at,
           m.updated_at,
           m.updated_at + make_interval(secs => $3::double precision)
      FROM malformed m
    ON CONFLICT (source, source_ref, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM read)::int      AS scanned,
         (SELECT count(*) FROM malformed)::int AS malformed,
         (SELECT count(*) FROM inserted)::int  AS created,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'tag_key', m.key,
                   'problems', to_jsonb(m.problems)
                 ) ORDER BY m.key), '[]'::jsonb)
            FROM malformed m)                  AS problems
`;

/**
 * One problem, as it reaches stdout.
 *
 * `problems` is the `jsonb_agg` the statement returns, and it is parsed rather
 * than trusted: a driver that handed back a string where an array was declared
 * would otherwise put `"[object Object]"` into an operator's log, which is the
 * kind of message that is read, believed, and not acted on.
 */
type Problem = { readonly tag_key: string; readonly problems: readonly string[] };

/**
 * The shape `CONSENT_CONFIG_MATERIALIZE_SQL` answers with. `pg` returns
 * `count(*)` from a bigint column as a STRING, so the `::int` casts in the
 * statement are what make these numbers; without them a summary would read
 * `created: '0'`.
 */
type MaterializeRow = {
  readonly scanned: number;
  readonly malformed: number;
  readonly created: number;
  readonly problems: readonly Problem[];
};

class ConsentConfigMaterializer implements Materializer {
  readonly source = 'consent_config';

  /**
   * The log is the report's other half, and it is a field rather than a
   * constructor argument for the reason `NotificationMaterializer` owns one:
   * `Logger` carries its own context and this class is never constructed by
   * hand outside this file.
   */
  private readonly logger = new Logger(ConsentConfigMaterializer.name);

  async materialize(
    client: PoolClient,
    window: MaterializeWindow,
    expirySeconds: number,
  ): Promise<MaterializeSummary> {
    const result = await client.query<MaterializeRow>(CONSENT_CONFIG_MATERIALIZE_SQL, [
      this.source,
      window.floorAt.toISOString(),
      expirySeconds,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      // A bare SELECT over CTEs always produces one row, so no row is not a shape
      // this SQL can take — and reporting `scanned: 0` here would be the
      // success-shaped lie §2.3 is about.
      throw new Error(`${this.source}: the materialise statement returned no summary row`);
    }

    // EVERY problem is logged, not only the ones this pass created. The window
    // overlaps, so the same broken tag is read again on the next pass; logging
    // only `created` would mean a tag nobody dismissed went quiet after one line,
    // and "it stopped being reported" and "it stopped being broken" would look the
    // same from an operator's chair.
    for (const problem of row.problems) {
      this.logger.warn(
        `${this.source}: consent tag '${problem.tag_key}' is misconfigured and will not work as configured — ` +
          `${problem.problems.join('; ')}`,
      );
    }

    return { source: this.source, scanned: row.scanned, created: row.created };
  }
}

export const consentConfigMaterializer: Materializer = new ConsentConfigMaterializer();