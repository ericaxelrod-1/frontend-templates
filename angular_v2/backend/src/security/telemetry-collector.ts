import { Injectable } from '@nestjs/common';
import type { AttemptKind } from '../auth/auth.service.js';
import type { PatternSeverity } from './pattern-registry.js';

/**
 * The in-memory aggregation of what the request path saw.
 *
 * ## WHAT THIS IS, AND WHY IT IS IN MEMORY
 *
 * The request path must not write to the four telemetry tables: a scanner sending
 * ten thousand requests would generate ten thousand rows, and the request would
 * wait for a database round trip it does not need. So the request path does the
 * CHEAP half — recognise a pattern, count it — and this collector holds the
 * counts until the flush job persists them.
 *
 * **The write is out of the request path, and it is not a fire-and-forget
 * promise.** `SecurityTelemetryFlush` runs as a scheduled job under the
 * scheduler's advisory lock, writes the four tables in ONE transaction, and is
 * idempotent, so a run that is interrupted is re-run rather than half-applied.
 *
 * ## THE CRASH WINDOW, STATED RATHER THAN HIDDEN
 *
 * A pattern observed in the last few seconds and not yet flushed is lost if the
 * process dies. That is a real bound and it is bounded by the flush interval
 * (`SECURITY_TELEMETRY_FLUSH_SECONDS`), not by the volume of traffic.
 *
 * **What is NOT lost is the attempt itself.** `login_attempts` is durable, is
 * written by the auth service in its own committed transaction before any
 * credential check, and holds the identity that was attempted. So the evidence a
 * pattern is built from outlives the classification of it: an operator who loses a
 * window of classifications still has every attempt row, and the flush joins the
 * patterns it does have back to those rows.
 *
 * ## WHAT IS BOUNDED, AND WHY
 *
 * A hostile caller controls the number of distinct addresses and the number of
 * distinct identities, so an unbounded collector is a memory exhaustion attack on
 * the process that watches for attacks. Two bounds apply, and **both of them are
 * LOUD**: the truncation is counted, and the flush logs it. A silently truncated
 * count is a number that reads like a complete one, which is §2.3's failure mode.
 */

/** The most distinct (pattern, address) pairs held at once. */
export const MAX_TELEMETRY_BUCKETS = 500;

/** The most distinct identities remembered for one pattern inside one window. */
export const MAX_SUBJECTS_PER_BUCKET = 500;

/** One detection, as the request path saw it. */
export type TelemetryObservation = {
  /** The pattern's type, from the registry. */
  readonly type: string;
  /** The pattern's severity, from the registry. */
  readonly severity: PatternSeverity;
  /** The address as it arrived. */
  readonly ip: string;
  /** The canonical form — the key every counter is held against. */
  readonly ipNormalized: string;
  /** The aggregation key — a /64 for IPv6, the host itself for IPv4. */
  readonly ipSubnet: string;
  /** The identity the request was aimed at, or `null` when the route is not an attempt. */
  readonly subject: string | null;
  /** The kind of attempt, or `null` when the route is not an attempt. */
  readonly attemptKind: AttemptKind | null;
  /** The dispatch token of the route the request arrived on. */
  readonly route: string;
  /** The NAME of the field that matched. Never its value. */
  readonly field: string;
  /** When it was seen. A value, never a clock call — see `breaker-state.ts`. */
  readonly observedAtMs: number;
};

/** One pattern, one address, one window. */
export type PatternBucket = {
  readonly type: string;
  readonly severity: PatternSeverity;
  readonly ip: string;
  readonly ipNormalized: string;
  readonly ipSubnet: string;
  /** When the window opened — the first observation. */
  readonly windowStartMs: number;
  /** When the pattern was last seen. */
  readonly lastSeenMs: number;
  /** How many matching requests the window holds. */
  readonly attemptCount: number;
  /** The distinct identities the pattern touched. */
  readonly subjects: readonly string[];
  /** The names of the fields that matched. Never their values. */
  readonly fields: readonly string[];
  /** The routes the pattern was seen on. */
  readonly routes: readonly string[];
  /** The kinds of attempt the pattern was seen as. */
  readonly attemptKinds: readonly AttemptKind[];
  /** Whether the window has closed and the bucket may be retired. */
  readonly windowClosed: boolean;
  /** Whether an alert has already been raised for this window. */
  readonly alerted: boolean;
  /** The bucket's identity, for closing it again. */
  readonly key: string;
  /** The bucket's revision, so a bucket that changed under the flush is not retired. */
  readonly revision: number;
};

type MutableBucket = {
  type: string;
  severity: PatternSeverity;
  ip: string;
  ipNormalized: string;
  ipSubnet: string;
  windowStartMs: number;
  lastSeenMs: number;
  attemptCount: number;
  readonly subjects: Set<string>;
  readonly fields: Set<string>;
  readonly routes: Set<string>;
  readonly attemptKinds: Set<AttemptKind>;
  subjectsTruncated: boolean;
  alerted: boolean;
  revision: number;
};

/**
 * What one flush found, and what it had to leave behind.
 *
 * The truncation counters are part of the RESULT rather than a log line, so the
 * flush can report them and a reader of the report knows the numbers are bounds
 * and not counts.
 */
export type TelemetrySnapshot = {
  readonly buckets: readonly PatternBucket[];
  /** Observations that arrived after the collector was full. */
  readonly droppedObservations: number;
  /** Buckets whose identity list hit its ceiling. */
  readonly truncatedBuckets: number;
};

@Injectable()
export class SecurityTelemetryCollector {
  private readonly buckets = new Map<string, MutableBucket>();
  private droppedObservations = 0;
  private truncatedBuckets = 0;

  /**
   * Records one detection.
   *
   * **No I/O, no await, no allocation beyond the bucket.** This runs on the request
   * path, so it must not open a transaction, must not read a clock and must not
   * fail the request. The clock is a value the caller supplies, for the reason
   * `breaker-state.ts` exists: a test that has to wait for wall time to cross a
   * window boundary is a test that will pass on the wrong side of it.
   */
  observe(observation: TelemetryObservation): void {
    const key = `${observation.type}|${observation.ipNormalized}`;
    const existing = this.buckets.get(key);
    if (existing === undefined) {
      if (this.buckets.size >= MAX_TELEMETRY_BUCKETS) {
        this.droppedObservations += 1;
        return;
      }
      this.buckets.set(key, {
        type: observation.type,
        severity: observation.severity,
        ip: observation.ip,
        ipNormalized: observation.ipNormalized,
        ipSubnet: observation.ipSubnet,
        windowStartMs: observation.observedAtMs,
        lastSeenMs: observation.observedAtMs,
        attemptCount: 1,
        subjects: new Set<string>(),
        fields: new Set<string>(),
        routes: new Set<string>(),
        attemptKinds: new Set<AttemptKind>(),
        subjectsTruncated: false,
        alerted: false,
        revision: 1,
      });
    } else {
      existing.lastSeenMs = Math.max(existing.lastSeenMs, observation.observedAtMs);
      existing.attemptCount += 1;
      existing.revision += 1;
    }
    const bucket = this.buckets.get(key);
    if (bucket === undefined) {
      return;
    }
    if (observation.subject !== null && !bucket.subjects.has(observation.subject)) {
      if (bucket.subjects.size >= MAX_SUBJECTS_PER_BUCKET) {
        if (!bucket.subjectsTruncated) {
          bucket.subjectsTruncated = true;
          this.truncatedBuckets += 1;
        }
      } else {
        bucket.subjects.add(observation.subject);
      }
    }
    bucket.fields.add(observation.field);
    bucket.routes.add(observation.route);
    if (observation.attemptKind !== null) {
      bucket.attemptKinds.add(observation.attemptKind);
    }
  }

  /**
   * Every bucket, and whether its window has closed.
   *
   * **A closed window is not retired here.** The bucket is retired only after the
   * flush that wrote it has committed, so a failed write loses nothing: the same
   * bucket is written again by the next pass.
   */
  pending(nowMs: number, windowSeconds: number): TelemetrySnapshot {
    const windowMs = windowSeconds * 1000;
    const buckets: PatternBucket[] = [];
    for (const [key, bucket] of this.buckets) {
      buckets.push({
        type: bucket.type,
        severity: bucket.severity,
        ip: bucket.ip,
        ipNormalized: bucket.ipNormalized,
        ipSubnet: bucket.ipSubnet,
        windowStartMs: bucket.windowStartMs,
        lastSeenMs: bucket.lastSeenMs,
        attemptCount: bucket.attemptCount,
        subjects: [...bucket.subjects],
        fields: [...bucket.fields],
        routes: [...bucket.routes],
        attemptKinds: [...bucket.attemptKinds],
        windowClosed: nowMs - bucket.windowStartMs >= windowMs,
        alerted: bucket.alerted,
        key,
        revision: bucket.revision,
      });
    }
    return {
      buckets,
      droppedObservations: this.droppedObservations,
      truncatedBuckets: this.truncatedBuckets,
    };
  }

  /**
   * Retires a bucket whose window has closed.
   *
   * **The revision guard is the point.** A request that arrived between the
   * snapshot and this call has added to the bucket, and retiring it would throw
   * that observation away. The bucket is left alone and the next pass writes it
   * again, with the observation included.
   */
  close(bucket: PatternBucket): void {
    const current = this.buckets.get(bucket.key);
    if (current === undefined || current.revision !== bucket.revision) {
      return;
    }
    this.buckets.delete(bucket.key);
  }

  /**
   * Records that this window's alert has been raised.
   *
   * **The revision is deliberately NOT bumped.** The revision counts OBSERVATIONS,
   * and it is what stops a bucket that gained an observation between the snapshot
   * and the write from being retired with that observation thrown away. The alert
   * flag is not an observation, and bumping the revision here would make every
   * bucket that had raised an alert un-retirable — the window would never close.
   */
  markAlerted(key: string): void {
    const current = this.buckets.get(key);
    if (current === undefined) {
      return;
    }
    current.alerted = true;
  }

  /**
   * The counters, for the flush's report.
   *
   * Read once and reset by the flush that reports them, so the number in the log
   * is the number since the last log rather than a total nobody can act on.
   */
  takeLossCounters(): { droppedObservations: number; truncatedBuckets: number } {
    const counters = {
      droppedObservations: this.droppedObservations,
      truncatedBuckets: this.truncatedBuckets,
    };
    this.droppedObservations = 0;
    this.truncatedBuckets = 0;
    return counters;
  }

  /** How many buckets are held. Used by the flush's report and by the suite. */
  get size(): number {
    return this.buckets.size;
  }
}
