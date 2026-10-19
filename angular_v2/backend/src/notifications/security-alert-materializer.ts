import type { PoolClient } from 'pg';
import type { MaterializeSummary, MaterializeWindow, Materializer } from './materializer.js';

/**
 * The `public.security_alerts` materializer — the first source onto the generic
 * panel, and the worked example every later source will be copied from.
 *
 * ## WHAT THIS DOES WITH EACH COLUMN
 *
 * `security_alerts` is not this table's shape, and the mapping is where most of the
 * decisions above get spent. In one statement, because a materializer that splits the
 * mapping across two passes has two chances to disagree with itself:
 *
 *   alert.severity/title/message   → straight across. A notification has the same four.
 *   alert.alert_type               → `kind`, the second half of the discriminator pair.
 *                                    This is what keeps the panel's "Alert type"
 *                                    filter working after it stops reading the source.
 *   alert.id                       → `source_ref`, as text. The identity of the row.
 *   alert.user_id                  → `audience`/`user_id`, per the rule below.
 *   alert.is_mock                  → straight across, so a synthetic source row stays
 *                                    identifiable once it has been rendered.
 *   alert.created_at               → `created_at`, NOT `now()`. "Raised" on the panel
 *                                    is when the alert was raised, and a materialiser
 *                                    that stamps its own clock reports when the job
 *                                    happened to run — which for a backfilled alert is
 *                                    today, for every alert at once.
 *   alert.pattern_id, ip,          → `data`, as jsonb.
 *     ip_normalized, ip_subnet,
 *     alert_data
 *   alert.expires_at               → IGNORED, and deliberately. The expiry of a
 *                                    notification is a decision of this materialiser,
 *                                    taken from `NOTIFICATIONS_EXPIRY_SECONDS`. Copying
 *                                    the source's would let a source table that has
 *                                    never been given an expiry publish rows that never
 *                                    expire, which is the five-year-old-alert failure
 *                                    arriving through the back door.
 *   alert.status,                  → IGNORED. See the migration's "WHY THERE IS NO
 *     acknowledged_at,              `status` COLUMN": a notification's lifecycle is
 *     acknowledged_by,              its own. Copying the source's would put one fact in
 *     resolved_at/by,               two places, and the two would drift the first time
 *     resolution_notes              either side was edited.
 *
 * ## THE ADDRESSING RULE, AND WHY IT IS NOT "COPY `user_id`"
 *
 *   alert has a `user_id`  →  `audience = 'all'`, `user_id` set. That person sees it,
 *                              and so does every administrator. This is the widening
 *                              the user-scoped column exists FOR, and it is the reason
 *                              the brief asks the addressing question at all.
 *   alert has no `user_id` →  `audience = 'administrators'`. NOT `audience = 'all'`
 *                              with a NULL user, which would publish every unaddressed
 *                              security alert to every authenticated member — strictly
 *                              more than `0022` grants today, where `security_alerts`
 *                              is `app_admin` and nothing else.
 *
 * ## IDEMPOTENCE — the property `JobRunner` requires of every job body
 *
 * `JobRunner` records nothing about a run, so a job killed mid-body is re-run from the
 * beginning by the next process that takes the lock. Writing the same derived row
 * twice must therefore be the same as writing it once, and that is `ON CONFLICT DO
 * NOTHING` against `UNIQUE NULLS NOT DISTINCT (source, source_ref, user_id)`.
 *
 * It is the same clause that stops a dismissal being resurrected: an existing row is
 * left completely alone, `dismissed_at` included. `ON CONFLICT DO UPDATE` would be
 * the tempting alternative and it is what would break — it touches the row, so it can
 * clear a dismissal, and it makes a dismissed notification an UPDATE the materialiser
 * has to get right on every single pass.
 *
 * ## ONE STATEMENT, AND WHY IT IS NOT TWO
 *
 * The read and the insert share a CTE, so `scanned` and `created` describe the SAME
 * snapshot. Two round trips would let a source row arrive between them and report a
 * count of rows that were never considered.
 *
 * `now()` appears in the statement's ceiling rather than arriving as a parameter, and
 * `MaterializeWindow` carries a floor and no ceiling for the reason that file gives:
 * a ceiling read from the application's clock is a comparison between two clocks, and
 * it loses rows written in the microseconds between the sampler and this statement.
 */
export const SECURITY_ALERTS_MATERIALIZE_SQL = `
  WITH bounds AS (
    SELECT $2::timestamptz AS floor_at, now() AS ceiling_at
  ),
  read AS (
    SELECT a.id, a.alert_type, a.severity, a.title, a.message, a.user_id,
           a.pattern_id, a.ip, a.ip_normalized, a.ip_subnet, a.alert_data,
           a.is_mock, a.created_at
    FROM public.security_alerts a, bounds b
    WHERE a.created_at >= b.floor_at
      AND a.created_at <= b.ceiling_at
  ),
  inserted AS (
    INSERT INTO public.admin_notifications (
      source, kind, severity, title, message, data, source_ref,
      audience, user_id, is_mock, created_at, updated_at, expires_at
    )
    SELECT $1,
           r.alert_type,
           r.severity,
           r.title,
           r.message,
           jsonb_strip_nulls(
             jsonb_build_object(
               'pattern_id',     r.pattern_id,
               'ip',             r.ip,
               'ip_normalized',  r.ip_normalized,
               'ip_subnet',      r.ip_subnet,
               'alert_data',     r.alert_data
             )
           ),
           r.id::text,
           CASE WHEN r.user_id IS NULL THEN 'administrators' ELSE 'all' END,
           r.user_id,
           r.is_mock,
           r.created_at,
           r.created_at,
           r.created_at + make_interval(secs => $3::double precision)
    FROM read r
    ON CONFLICT (source, source_ref, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM read)::int    AS scanned,
         (SELECT count(*) FROM inserted)::int AS created
`;

/**
 * The shape `SECURITY_ALERTS_MATERIALIZE_SQL` answers with. `pg` returns `count(*)`
 * from a bigint column as a STRING, so the `::int` casts above are what make this a
 * number; without them a summary would read `created: '0'` and any arithmetic on it
 * would concatenate.
 */
type MaterializeRow = { readonly scanned: number; readonly created: number };

class SecurityAlertsMaterializer implements Materializer {
  readonly source = 'security_alerts';

  async materialize(
    client: PoolClient,
    window: MaterializeWindow,
    expirySeconds: number,
  ): Promise<MaterializeSummary> {
    const result = await client.query<MaterializeRow>(SECURITY_ALERTS_MATERIALIZE_SQL, [
      this.source,
      window.floorAt.toISOString(),
      expirySeconds,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      // The statement is a bare SELECT over CTEs, so a SELECT that produced no row is
      // not a shape this SQL can take — and reporting `scanned: 0` here would be
      // exactly the success-shaped lie §2.3 is about.
      throw new Error(`${this.source}: the materialise statement returned no summary row`);
    }
    return { source: this.source, scanned: row.scanned, created: row.created };
  }
}

export const securityAlertsMaterializer: Materializer = new SecurityAlertsMaterializer();