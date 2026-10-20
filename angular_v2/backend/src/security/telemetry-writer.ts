import type { PoolClient } from 'pg';
import type { PatternBucket, TelemetrySnapshot } from './telemetry-collector.js';
import type { TelemetryEnvironment } from './telemetry-environment.js';

/**
 * The writer: the four security-telemetry tables, from one snapshot, in one
 * transaction.
 *
 * ## HOW THE WRITE REACHES THE DATABASE, AND WHY
 *
 * **Through `pg`, on the shared pool, inside `SET LOCAL ROLE app_admin` — the
 * escalation boundary every other writer in this application crosses.**
 *
 * The alternative was PostgREST, and it is the wrong answer for two reasons that
 * are both about the request path:
 *
 *   * **A write through PostgREST from inside a request handler is a request to
 *     the service's own data layer.** It is a network round trip to another
 *     process that then opens a database connection of its own, it is not
 *     transactional with anything else this process does, and it needs a role
 *     that may write these tables — which `app_admin` already is, and which
 *     `pgrst_authenticator` reaches through `SET LOCAL ROLE` rather than by
 *     impersonation.
 *   * **PostgREST's write surface is the CRUD surface**, and these four tables
 *     are read by the admin pages through it. Writing them from the same place
 *     would put a producer on the read path of the very pages it feeds.
 *
 * The `pg` route is also the one the tree already uses for every write that is
 * not plain CRUD, which is what `AGENTS.md` §B1 means by "PostgREST serves base
 * tables" — the API layer serves the reads; the writers that need a transaction,
 * a role, or an ordering use the database directly.
 *
 * ## EVERY STATEMENT IS IDEMPOTENT, BECAUSE THE JOB MAY BE RE-RUN
 *
 * The scheduler's advisory lock buys "at most one at a time", not "at least
 * once": a job killed mid-body is re-run from the beginning by the next process
 * that gets the lock. So every write here is safe to repeat:
 *
 *   * the pattern row is UPDATEd in place and INSERTed only when it is absent;
 *   * the links use `ON CONFLICT (pattern_id, login_attempt_id) DO NOTHING`;
 *   * the alert is written once per pattern window and the collector remembers
 *     that it has been written;
 *   * the reputation row is an upsert on the canonical address.
 *
 * ## WHAT IS NEVER WRITTEN
 *
 *   * **A credential, a token, or a request body.** The evidence is the pattern's
 *     type, the names of the fields that matched, the routes, the counts and the
 *     timestamps. The VALUES are not in it, and they are not in the alert's
 *     message either. §2.5 forbids it and the evidence column wants to hold the
 *     request, which is exactly the reason it must not.
 *   * **A place.** `geo_location` is not in the INSERT at all, so the column keeps
 *     its default and stays NULL. See the geo-blocking finding in
 *     `docs/deployment-guide.md`: this template has no data source that could
 *     derive a country, so the honest state is an empty column rather than a
 *     default that reads like an answer.
 *   * **A block.** `is_blocked` is not in the INSERT either, and the upsert does
 *     not touch it. §B6: behavioural and risk scoring is TRIAGE, not prevention —
 *     it informs a decision, it never silently blocks. A producer that filled
 *     that column would be a producer that could deny a request by writing a
 *     boolean, and nothing reads it anyway.
 *   * **`is_mock`.** The producer neither writes it nor reads it. It is a DISPLAY
 *     label — a filter an operator toggles — and a row that carried a real
 *     finding must not be labelled synthetic, and a synthetic row must not be
 *     un-labelled by a producer that has no opinion about which it was. The
 *     column therefore keeps its schema default on insert and is untouched by
 *     the upsert.
 *
 *     **The consequence, stated rather than discovered:** the unique key of
 *     `ip_reputation` is the canonical address, so a seeded fixture and a live
 *     row for the same address are the SAME row — the live counters land on the
 *     fixture and the display flag stays where the seed put it, so the row
 *     remains hidden behind the "show test rows" toggle. That is why the seed
 *     writes RFC 5737 documentation addresses: an address that real traffic
 *     cannot use is an address the two cannot collide on.
 *
 * ## WHAT ERASURE REACHES, AND WHAT IT DOES NOT
 *
 * **Nothing this writer produces identifies a person by a foreign key.**
 * `security_alerts.user_id` is left NULL, because an alert here is about a HOST
 * and not about a user; `security_detected_patterns` and `ip_reputation` have no
 * user column at all. The one row in the chain that does name a person is
 * `login_attempts.username` — and the erasure already rewrites that to the
 * tombstone (`ANONYMISE_LOGIN_ATTEMPTS_SQL`), so the link from a pattern to the
 * attempts that prove it survives as a link with the name behind it gone.
 *
 * **The address is retained, deliberately.** An address is personal data, and the
 * rows here carry one; they survive the erasure of any one person because a
 * HOST row is not a person's record — it is the record of whoever used that
 * host, which may be many people, and the forensic value of "this host tried
 * fourteen accounts in a quarter of an hour" does not belong to the first person
 * who happened to use it. That is the same trade `0024_alert_subject_cascade.sql`
 * records for `security_alerts`: §B6's "security alerts persist to the database"
 * is about alerts being RECORDED rather than about them outliving the erasure
 * of the person they describe, and a row that names nobody cannot be said to
 * describe anybody.
 *
 * **What a fork that wants the address erased must do is delete the host's rows
 * when the host's last user is erased**, which is a decision about a HOST and
 * belongs to whoever owns the retention policy.
 */

/** The most attempt rows one pattern may link to. A bound on a query, not a threshold. */
export const MAX_LINKED_ATTEMPTS_PER_PATTERN = 200;

/** The summary one flush produced. */
export type TelemetryWriteSummary = {
  readonly patterns: number;
  readonly links: number;
  readonly alerts: number;
  /** The buckets whose alert was raised, so the collector can remember it. */
  readonly alertedKeys: readonly string[];
  readonly reputationRows: number;
};

/**
 * The pattern row, updated in place.
 *
 * `IS NOT DISTINCT FROM` rather than `=` for the address, because a request with
 * no address has a NULL there and `= NULL` is never true — which would make the
 * UPDATE match nothing and turn every flush into an INSERT.
 */
export const UPDATE_DETECTED_PATTERN_SQL = `
  UPDATE public.security_detected_patterns
     SET severity            = $2,
         ip                  = $3,
         ip_subnet           = $4,
         detection_timestamp = $5,
         time_window_end     = $6,
         attempt_count       = $7,
         unique_email_count  = $8,
         evidence            = $9,
         updated_at          = now()
   WHERE pattern_type = $1
     AND ip_normalized IS NOT DISTINCT FROM $10
     AND time_window_start = $11
 RETURNING id
`;

/**
 * The pattern row, inserted when it is not there yet.
 *
 * **The `WHERE NOT EXISTS` is the idempotence.** The table has no unique index
 * over (pattern type, address, window start), so the guard is a predicate rather
 * than an `ON CONFLICT`. The flush runs under the scheduler's advisory lock, so
 * two instances cannot be inside this statement at the same time; the guard is
 * there for the case where a row already exists from an earlier run.
 */
export const INSERT_DETECTED_PATTERN_SQL = `
  INSERT INTO public.security_detected_patterns (
    pattern_type, severity, ip, ip_normalized, ip_subnet,
    detection_timestamp, time_window_start, time_window_end,
    attempt_count, unique_email_count, evidence
  )
  SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
   WHERE NOT EXISTS (
     SELECT 1 FROM public.security_detected_patterns
      WHERE pattern_type = $1
        AND ip_normalized IS NOT DISTINCT FROM $4
        AND time_window_start = $7
   )
 RETURNING id
`;

/**
 * The evidence rows: the attempts that prove the pattern.
 *
 * **The join is by IDENTITY and ADDRESS, not by "the request that matched".** The
 * database records which identity was attempted and from where; it does not
 * record which field of the request carried the pattern, and the producer does
 * not write that down either, because the field's VALUE is the thing that must
 * never be stored. So the link is to the attempt rows that carry the observed
 * identity from the observed address inside the pattern's window, and where two
 * attempts share an identity and an address inside one window, both are linked:
 * they are the same attempt at the same thing.
 *
 * `is_primary_evidence` marks the EARLIEST of them, because the first attempt is
 * the one an investigator starts from.
 */
export const INSERT_PATTERN_LOGIN_ATTEMPTS_SQL = `
  INSERT INTO public.pattern_login_attempts (pattern_id, login_attempt_id, is_primary_evidence)
  SELECT $1, la.id, (row_number() OVER (ORDER BY la.created_at, la.id) = 1)
    FROM public.login_attempts la
   WHERE la.username = ANY($2::text[])
     AND la.ip_normalized = $3
     AND la.attempt_kind = ANY($4::text[])
     AND la.created_at >= $5
     AND la.created_at <= $6
   ORDER BY la.created_at, la.id
   LIMIT $7
  ON CONFLICT (pattern_id, login_attempt_id) DO NOTHING
`;

/**
 * The alert.
 *
 * **`source` is `system`** — the only value the schema's CHECK admits for a row
 * nobody raised by hand — and `user_id` is left NULL, so the notification
 * materialiser addresses it to the administrators and to nobody else.
 */
export const INSERT_SECURITY_ALERT_SQL = `
  INSERT INTO public.security_alerts (
    alert_type, severity, title, message, source, pattern_id,
    ip, ip_normalized, ip_subnet, alert_data
  )
  VALUES ($1, $2, $3, $4, 'system', $5, $6, $7, $8, $9)
`;

/**
 * The hosts the reputation rows are written for.
 *
 * **Three sources, unioned:** the hosts that failed an attempt inside the
 * window, the hosts a challenge was issued to, and the hosts the collector saw a
 * pattern on. The first two come from durable tables, so a host that has failed
 * attempts and never matched a pattern still has a reputation row — which is the
 * whole point of the row.
 *
 * `DISTINCT ON (ip_normalized)` picks ONE spelling of each address, and it
 * wraps the WHOLE union rather than one branch of it: the same host arrives in
 * two spellings, and a row per spelling would be two reputation rows fighting
 * over the same key — and the second upsert would overwrite the first.
 */
export const SELECT_REPUTATION_HOSTS_SQL = `
  SELECT DISTINCT ON (hosts.ip_normalized) hosts.ip_normalized, hosts.ip_subnet, hosts.ip
    FROM (
      SELECT ip_normalized, ip_subnet, ip
        FROM public.login_attempts
       WHERE created_at >= $1 AND ip_normalized IS NOT NULL
      UNION
      SELECT ip_normalized, ip_subnet, ip
        FROM public.captcha
       WHERE expires_at > now() AND ip_normalized IS NOT NULL
      UNION
      SELECT b.ip_normalized, b.ip_subnet, b.ip
        FROM unnest($2::text[], $3::text[], $4::text[]) AS b(ip_normalized, ip_subnet, ip)
    ) hosts
   ORDER BY hosts.ip_normalized
`;

/**
 * One host's observed behaviour, in one round trip.
 *
 * **The failed attempts are counted over the WHOLE RECORD, and the score is
 * computed over the WINDOW.** The column is a standing counter — "this host has
 * failed N times" is a fact about the host, not about the last quarter of an
 * hour — and a score that fell on a standing counter would reach zero for every
 * host eventually and stop meaning anything. So the standing count is the
 * column, the recent count is the score, and `statistics` carries both so a
 * reader is never left guessing which is which.
 */
export const SELECT_HOST_BEHAVIOUR_SQL = `
  SELECT
    (SELECT count(*) FROM public.login_attempts la
      WHERE la.ip_subnet = $1 AND la.ip_normalized = $2 AND la.status = 'failed')::int
      AS failed_attempts,
    (SELECT count(*) FROM public.login_attempts la
      WHERE la.ip_subnet = $1 AND la.ip_normalized = $2 AND la.status = 'failed'
        AND la.created_at >= $3 AND la.created_at <= $4)::int
      AS window_failed_attempts,
    (SELECT count(DISTINCT la.username) FROM public.login_attempts la
      WHERE la.ip_subnet = $1 AND la.ip_normalized = $2
        AND la.created_at >= $3 AND la.created_at <= $4)::int
      AS window_distinct_identities,
    (SELECT count(*) FROM public.captcha c
      WHERE c.ip_subnet = $1 AND c.ip_normalized = $2 AND c.expires_at > now())::int
      AS captcha_required
`;

/**
 * The reputation row.
 *
 * **No `is_blocked`, no `blocked_until`, no `geo_location`** — see the file
 * header. The upsert updates the score and the counters and leaves everything
 * else alone, so a row this producer created says exactly what this producer
 * observed.
 */
export const UPSERT_IP_REPUTATION_SQL = `
  INSERT INTO public.ip_reputation (
    ip, ip_normalized, ip_subnet, status, reputation_score,
    failed_attempts, captcha_required_count, statistics, block_history, updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, now())
  ON CONFLICT (ip_normalized) DO UPDATE
     SET status               = EXCLUDED.status,
         reputation_score     = EXCLUDED.reputation_score,
         failed_attempts      = EXCLUDED.failed_attempts,
         captcha_required_count = EXCLUDED.captcha_required_count,
         statistics           = EXCLUDED.statistics,
         updated_at           = now()
`;

/** The score bands, as the two numbers the configuration names. */
export type ReputationStatus = 'good' | 'suspicious' | 'bad';

/**
 * The status a score earns.
 *
 * **A pure function of the score and the two configured bands**, so a reader can
 * check it by hand and a test can check it without a database.
 */
export function reputationStatusFor(
  score: number,
  env: TelemetryEnvironment,
): ReputationStatus {
  if (score < env.reputationBadScore) {
    return 'bad';
  }
  if (score < env.reputationSuspiciousScore) {
    return 'suspicious';
  }
  return 'good';
}

/**
 * The score.
 *
 * **The window's failures and the window's pattern matches each cost the
 * configured penalty**, and the result is clamped to the scale. The clamp is
 * what stops a long-lived noisy host from producing a score below zero, which
 * would make the band comparison meaningless.
 */
export function reputationScoreFor(
  windowFailedAttempts: number,
  patternMatches: number,
  env: TelemetryEnvironment,
): number {
  const raw =
    env.reputationBaseScore -
    env.reputationPenalty * (windowFailedAttempts + patternMatches);
  return Math.max(0, Math.min(env.reputationBaseScore, raw));
}

/**
 * Writes the whole snapshot.
 *
 * **One transaction, and the caller owns it.** The flush opens the transaction,
 * crosses the escalation boundary, calls this, and commits — so a failure
 * anywhere leaves the four tables exactly as they were, and the next pass writes
 * the same snapshot again.
 */
export async function writeTelemetry(
  client: PoolClient,
  snapshot: TelemetrySnapshot,
  env: TelemetryEnvironment,
  nowMs: number,
): Promise<TelemetryWriteSummary> {
  const now = new Date(nowMs);
  const windowMs = env.windowSeconds * 1000;
  let patterns = 0;
  let links = 0;
  const alertedKeys: string[] = [];
  const patternIds = new Map<string, string>();

  for (const bucket of snapshot.buckets) {
    const patternId = await writePattern(client, bucket, env, windowMs);
    patterns += 1;
    patternIds.set(bucket.key, patternId);
    const linked = await writeLinks(client, patternId, bucket, now);
    links += linked;
  }

  for (const bucket of snapshot.buckets) {
    const patternId = patternIds.get(bucket.key);
    if (patternId === undefined) {
      continue;
    }
    const raised = await writeAlert(client, patternId, bucket, env, windowMs);
    if (raised) {
      alertedKeys.push(bucket.key);
    }
  }

  const reputationRows = await writeReputation(client, snapshot, env, now, windowMs);

  return { patterns, links, alerts: alertedKeys.length, alertedKeys, reputationRows };
}

/**
 * The pattern row, and its id.
 *
 * **UPDATE first, INSERT second.** The update is what keeps a pattern that is
 * still being seen from becoming a new row every flush; the insert is what
 * creates the window's first row. They are two statements rather than one
 * upsert because the table has no unique index to upsert against, and the
 * flush's advisory lock is what makes the pair atomic in the sense that matters:
 * no two runs can be inside it at once.
 */
async function writePattern(
  client: PoolClient,
  bucket: PatternBucket,
  env: TelemetryEnvironment,
  windowMs: number,
): Promise<string> {
  const windowStart = new Date(bucket.windowStartMs);
  const windowEnd = new Date(bucket.windowStartMs + windowMs);
  const normalized = bucket.ipNormalized === '' ? null : bucket.ipNormalized;
  const evidence = {
    matched_fields: bucket.fields,
    routes: bucket.routes,
    attempt_kinds: bucket.attemptKinds,
    window_seconds: env.windowSeconds,
    first_seen_at: windowStart.toISOString(),
    last_seen_at: new Date(bucket.lastSeenMs).toISOString(),
    distinct_identities: bucket.subjects.length,
  };

  const updated = await client.query<{ id: string }>(UPDATE_DETECTED_PATTERN_SQL, [
    bucket.type,
    bucket.severity,
    bucket.ip,
    bucket.ipSubnet,
    new Date(bucket.lastSeenMs),
    windowEnd,
    bucket.attemptCount,
    bucket.subjects.length,
    evidence,
    normalized,
    windowStart,
  ]);
  const existing = updated.rows[0];
  if (existing !== undefined) {
    return existing.id;
  }

  const inserted = await client.query<{ id: string }>(INSERT_DETECTED_PATTERN_SQL, [
    bucket.type,
    bucket.severity,
    bucket.ip,
    normalized,
    bucket.ipSubnet,
    new Date(bucket.lastSeenMs),
    windowStart,
    windowEnd,
    bucket.attemptCount,
    bucket.subjects.length,
    evidence,
  ]);
  const row = inserted.rows[0];
  if (row === undefined) {
    // The `WHERE NOT EXISTS` guard found a row the UPDATE had not matched — the
    // only way that happens is a row with a different `time_window_start` and the
    // same key, which the UPDATE's predicate would have matched. Reporting
    // `scanned: 0` here would be a success-shaped lie about a write that did
    // not happen.
    throw new Error(
      `the pattern row for ${bucket.type} from ${bucket.ipNormalized} could not be written: neither the ` +
        'update nor the insert produced a row',
    );
  }
  return row.id;
}

/** The evidence rows, and how many were written. */
async function writeLinks(
  client: PoolClient,
  patternId: string,
  bucket: PatternBucket,
  now: Date,
): Promise<number> {
  if (bucket.subjects.length === 0 || bucket.ipNormalized === '') {
    return 0;
  }
  const result = await client.query(INSERT_PATTERN_LOGIN_ATTEMPTS_SQL, [
    patternId,
    bucket.subjects,
    bucket.ipNormalized,
    bucket.attemptKinds,
    new Date(bucket.windowStartMs),
    now,
    MAX_LINKED_ATTEMPTS_PER_PATTERN,
  ]);
  return result.rowCount ?? 0;
}

/**
 * The alert, when the pattern has crossed its threshold.
 *
 * **Once per pattern window.** The collector remembers that the alert has been
 * raised, so a window that keeps being seen does not produce an alert per flush.
 */
async function writeAlert(
  client: PoolClient,
  patternId: string,
  bucket: PatternBucket,
  env: TelemetryEnvironment,
  windowMs: number,
): Promise<boolean> {
  if (bucket.alerted || bucket.attemptCount < env.alertThreshold) {
    return false;
  }
  const address = bucket.ipNormalized === '' ? 'an address the transport did not report' : bucket.ipNormalized;
  const windowEnd = new Date(bucket.windowStartMs + windowMs);
  await client.query(INSERT_SECURITY_ALERT_SQL, [
    bucket.type,
    bucket.severity,
    `Pattern ${bucket.type} observed from ${address}`,
    `${String(bucket.attemptCount)} matching requests were observed from ${address} within a ` +
      `${String(env.windowSeconds)}-second window, against ${String(bucket.subjects.length)} distinct ` +
      `identit${bucket.subjects.length === 1 ? 'y' : 'ies'}. The pattern is recorded for review; no request ` +
      'was refused on account of it.',
    patternId,
    bucket.ip,
    bucket.ipNormalized === '' ? null : bucket.ipNormalized,
    bucket.ipSubnet,
    {
      window_seconds: env.windowSeconds,
      attempt_count: bucket.attemptCount,
      distinct_identities: bucket.subjects.length,
      threshold: env.alertThreshold,
      routes: bucket.routes,
      matched_fields: bucket.fields,
      window_start: new Date(bucket.windowStartMs).toISOString(),
      window_end: windowEnd.toISOString(),
    },
  ]);
  return true;
}

/**
 * The reputation rows.
 *
 * **One host at a time, and the host list is the union of the durable tables and
 * the collector.** A host that has failed attempts and never matched a pattern
 * still has a row, because the row IS the standing reputation and a reputation
 * that only exists for hosts the collector happened to see would be a record of
 * the detector rather than of the host.
 */
async function writeReputation(
  client: PoolClient,
  snapshot: TelemetrySnapshot,
  env: TelemetryEnvironment,
  now: Date,
  windowMs: number,
): Promise<number> {
  const windowStart = new Date(now.getTime() - windowMs);
  const bucketHosts = snapshot.buckets.map((bucket) => bucket.ipNormalized);
  const bucketSubnets = snapshot.buckets.map((bucket) => bucket.ipSubnet);
  const bucketIps = snapshot.buckets.map((bucket) => bucket.ip);

  const hosts = await client.query<{ ip_normalized: string; ip_subnet: string; ip: string }>(
    SELECT_REPUTATION_HOSTS_SQL,
    [windowStart, bucketHosts, bucketSubnets, bucketIps],
  );

  const matchesByHost = new Map<string, number>();
  for (const bucket of snapshot.buckets) {
    matchesByHost.set(bucket.ipNormalized, (matchesByHost.get(bucket.ipNormalized) ?? 0) + bucket.attemptCount);
  }

  let written = 0;
  for (const host of hosts.rows) {
    if (host.ip_normalized === '') {
      continue;
    }
    const behaviour = await client.query<{
      failed_attempts: number;
      window_failed_attempts: number;
      window_distinct_identities: number;
      captcha_required: number;
    }>(SELECT_HOST_BEHAVIOUR_SQL, [
      host.ip_subnet,
      host.ip_normalized,
      windowStart,
      now,
    ]);
    const counts = behaviour.rows[0];
    if (counts === undefined) {
      throw new Error(
        `the behaviour query for ${host.ip_normalized} returned no row; the reputation of that host cannot be written`,
      );
    }
    const patternMatches = matchesByHost.get(host.ip_normalized) ?? 0;
    const score = reputationScoreFor(counts.window_failed_attempts, patternMatches, env);
    const status = reputationStatusFor(score, env);
    await client.query(UPSERT_IP_REPUTATION_SQL, [
      host.ip,
      host.ip_normalized,
      host.ip_subnet,
      status,
      score,
      counts.failed_attempts,
      counts.captcha_required,
      {
        window_seconds: env.windowSeconds,
        window_failed_attempts: counts.window_failed_attempts,
        window_distinct_identities: counts.window_distinct_identities,
        pattern_matches: patternMatches,
        captcha_required: counts.captcha_required,
        score_penalty: env.reputationPenalty,
        score_base: env.reputationBaseScore,
      },
    ]);
    written += 1;
  }
  return written;
}
