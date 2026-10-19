import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { loadBreakerEnvironment } from '../../src/breaker/breaker-environment.js';
import type { BreakerEnvironment } from '../../src/breaker/breaker-environment.js';
import { BreakerGate } from '../../src/breaker/breaker-gate.js';
import type { DispatchAdmission } from '../../src/breaker/breaker-gate.js';
import { BreakerMeter } from '../../src/breaker/breaker-meter.js';
import { BreakerRegistry } from '../../src/breaker/breaker-registry.js';
import type { DispatchRefusal } from '../../src/breaker/breaker-state.js';
import { CGROUP_V2_LIMIT_FILE, CGROUP_V2_USAGE_FILE } from '../../src/breaker/memory-reading.js';
import type { MemoryProbeDeps } from '../../src/breaker/memory-reading.js';
import type { DatabaseConnectionSource } from '../../src/common/database-pool.js';
import type { PurgeExecutor } from '../../src/purge/purge-executor.js';
import type { PoolClient } from 'pg';
import { JobRunner } from '../../src/scheduler/job-runner.service.js';
import { loadTestEnvironment } from './database.js';

/**
 * **The breaker trip path, assembled once.**
 *
 * A breaker whose trip branch is never exercised is a control that has only been
 * described, so every suite that needs the gate to actually refuse something
 * drives the REAL objects — the real `BreakerMeter`, the real `BreakerGate`, the
 * real state machine — through a fixture *memory probe*, which is the one seam
 * the design provides for exactly this: the meter is handed a
 * `MemoryProbeDeps`, so the signal can be forced without allocating 9 exabytes.
 *
 * ## Why this is a support module and not copied into each spec
 *
 * `test/unit/breaker/breaker-trip-path.spec.ts` built this inline, and the first
 * retention scheduling spec needed the same shape. Two copies of a harness is how
 * the second one silently stops matching the first — a different `ENV`, a
 * different protected set, a probe that reports a slightly different percentage —
 * and the drift is invisible until a "the breaker refused" assertion passes for
 * the wrong reason. **One harness, imported by name, so the trip path a spec
 * claims to exercise is the trip path it actually exercises** (`AGENTS.md` §2.4).
 *
 * Nothing here is a mock of anything that exists: `BreakerMeter`, `BreakerGate`,
 * `BreakerRegistry` and the state machine are the shipped classes, and the
 * `MemoryProbeDeps` seam is a parameter the shipped code already accepts.
 */

export const MIB = 1024 * 1024;
const LIMIT_BYTES = 256 * MIB;

/**
 * The shipped protection set, verbatim from `backend/.env`.
 *
 * Six tokens, all of them request-path work or the instrument itself. **`purge.sweeper`
 * and `purge.enqueuer` are NOT in it**, which is the shipped decision and the one
 * `test/unit/purge/purge-enqueuer-scheduling.spec.ts` asserts rather than assumes.
 */
export const TRIP_ENV: BreakerEnvironment = loadBreakerEnvironment({
  BREAKER_MEMORY_GREEN: '60',
  BREAKER_MEMORY_YELLOW: '80',
  BREAKER_MEMORY_RED: '90',
  BREAKER_POLL_SECONDS: '30',
  BREAKER_COOLDOWN_SECONDS: '120',
  BREAKER_PROBE_TIMEOUT_SECONDS: '60',
  BREAKER_PROTECTED: 'auth.login,auth.refresh,auth.logout,auth.me,breaker.meter,breaker.gate',
});

/** A 256 MB cgroup v2 container reporting `percent` used. */
export function probeAt(percent: number): MemoryProbeDeps {
  const used = Math.round((LIMIT_BYTES * percent) / 100);
  return {
    readTextFile: (path) =>
      path === CGROUP_V2_LIMIT_FILE ? String(LIMIT_BYTES) : path === CGROUP_V2_USAGE_FILE ? String(used) : undefined,
    totalMemBytes: () => LIMIT_BYTES,
    freeMemBytes: () => LIMIT_BYTES - used,
  };
}

/** A memory reading that cannot be taken at all, so the meter publishes `usable: false`. */
export function unreadableProbe(): MemoryProbeDeps {
  return {
    readTextFile: () => undefined,
    totalMemBytes: () => 0,
    freeMemBytes: () => 0,
  };
}

export const T0 = 1_700_000_000_000;

/**
 * The connection source that refuses, and counts that it was reached.
 *
 * `connects() === 0` after a gated dispatch is the strongest available statement
 * that GATE is a DISPATCH decision and not a slow rejection: nothing was queued,
 * nothing was started, and nothing was half-applied.
 */
export class ProbeNeverReachedError extends Error {}

export function connectionSource(): { readonly source: DatabaseConnectionSource; readonly connects: () => number } {
  let connects = 0;
  return {
    source: {
      connect(): Promise<never> {
        connects += 1;
        return Promise.reject(new ProbeNeverReachedError('the job reached the database'));
      },
    },
    connects: () => connects,
  };
}

/** An executor that rejects if the drain ever runs work while the breaker is open. */
export function executorThatMustNotRun(): PurgeExecutor {
  return {
    execute(): Promise<number> {
      return Promise.reject(new Error('the executor ran while the breaker was open'));
    },
  };
}

/**
 * The refusal reason, off a union that must be narrowed to be read.
 *
 * `admission.refusal` on the admitted arm is a compile error, which is the point:
 * a test that asserted a refusal on an admission that was never refused could only
 * be written if the admission were a value that lies.
 */
export function refusalOf(admission: DispatchAdmission): DispatchRefusal {
  if (admission.admit) {
    throw new Error('expected the dispatch to be refused, and it was admitted');
  }
  return admission.refusal;
}

export type TripHarness = {
  readonly registry: BreakerRegistry;
  readonly scheduler: SchedulerRegistry;
  /**
   * The REAL `JobRunner`, bound to this harness's registry.
   *
   * Real, and not a stand-in: the retention jobs take their runner by injection, so
   * a spec that constructs a job has to hand it one. Nothing here connects — the
   * runner opens its dedicated connection inside `runExclusive()`, which a
   * scheduling spec reaches only through the interval, never by calling `tick()` —
   * so driving a job's control path needs no database.
   */
  readonly jobs: JobRunner;
  readonly gate: BreakerGate;
  readonly meterAt: (percent: number) => BreakerMeter;
};

/**
 * A registry, a gate and a meter factory, all sharing one registry.
 *
 * `meterAt` rather than a single meter because the trip path needs **two**
 * readings in one test — one that trips and one that has cooled — over the same
 * published state.
 *
 * `database` is where the runner's DEDICATED connection opens. The runner takes its
 * advisory lock on a connection of its own, and that connection goes to
 * `environment.database.database` — so a suite that proves a job against a
 * throwaway database has to point the runner there too. Otherwise the lock is
 * taken in the developer's own database, which is both a connection this suite
 * should not be opening and a lock that is not the one the proof is about.
 */
export function tripHarness(env: BreakerEnvironment = TRIP_ENV, database?: string): TripHarness {
  const registry = new BreakerRegistry(env);
  const scheduler = new SchedulerRegistry();
  const gate = new BreakerGate(registry, env, scheduler);
  const environment = loadTestEnvironment();
  return {
    registry,
    scheduler,
    jobs: new JobRunner(
      new ConfigService({
        environment:
          database === undefined
            ? environment
            : { ...environment, database: { ...environment.database, database } },
      }),
      scheduler,
    ),
    gate,
    meterAt: (percent: number) => new BreakerMeter(registry, probeAt(percent), scheduler),
  };
}

/**
 * The narrow `pg` client shape the retention jobs actually use.
 *
 * `DatabaseConnectionSource.connect()` returns a real `PoolClient`, and `pg.Pool`
 * is the only thing bound to it in application code (§2.2 forbids substituting a
 * fake of it). A *test* stand-in for the client is a different question from a
 * stand-in for the pool, and this is the seam the design already documents in
 * `purge-transaction.spec.ts`: the pool port is narrow precisely so a suite can
 * observe that a **gated** dispatch never reaches a connection at all. The
 * scripting below is a pg *client* double, used only in `*.spec.ts`, and it
 * records the statement text rather than inventing behaviour — every assertion
 * made against it is about which statements were issued and in what order.
 */
export type ScriptedStatement = {
  readonly text: string;
  readonly values: readonly unknown[];
};

export type ScriptedClient = {
  /** Every statement issued on this client, in order, text normalised to single spaces. */
  readonly statements: string[];
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(): void;
};

export type ScriptedResult = { readonly rows: unknown[]; readonly rowCount: number | null };

export type ScriptedPool = {
  readonly source: DatabaseConnectionSource;
  readonly connects: () => number;
  readonly statements: () => readonly ScriptedStatement[];
};

/**
 * The two hooks a scheduling suite needs and a plain answer table cannot give it.
 *
 * `block` is how a tick is made to **overrun**: the statement answers only once
 * `until` settles, so the caller controls exactly how long the job is in flight
 * and can stand a second tick in the middle of it. `onStatement` is how the
 * caller learns that the job has reached a given point, which is what makes
 * "abort it mid-transaction" a deterministic instruction rather than a sleep.
 */
export type ScriptedPoolOptions = {
  readonly block?: { readonly when: (statement: string) => boolean; readonly until: Promise<void> };
  readonly onStatement?: (statement: string) => void;
  /** Makes a statement reject, which is how a sweep is made to FAIL. */
  readonly raise?: { readonly when: (statement: string) => boolean; readonly error: Error };
};

/**
 * One scripted statement shape and the answers it gives, **in order**.
 *
 * A list rather than a single answer because the retention jobs call the same
 * statement once per unit of work — `authz.claim_due_purge()` once per purge, the
 * enqueue once per sweep — and a drain budget is precisely the assertion that the
 * Nth call does NOT happen. The last answer repeats, so "always one more row"
 * is one entry and "always nothing" is one entry.
 */
export type ScriptedAnswer = {
  readonly when: (statement: string) => boolean;
  readonly results: readonly ScriptedResult[];
};

/**
 * A connection source whose client replays scripted answers per statement shape.
 *
 * An unmatched statement returns zero rows, which is the safe default and is also
 * the truthful one: an unmodelled statement did nothing.
 */
export function scriptedPool(answers: readonly ScriptedAnswer[], options: ScriptedPoolOptions = {}): ScriptedPool {
  let connects = 0;
  const issued: ScriptedStatement[] = [];
  const cursors = new Map<ScriptedAnswer, number>();

  const source: DatabaseConnectionSource = {
    // `Promise.resolve` rather than `async`: the port is `Promise`-returning, and
    // an `async` body with nothing to await is the one shape of this double that
    // `require-await` is right about.
    connect(): Promise<PoolClient> {
      connects += 1;
      const client: ScriptedClient = {
        statements: [],
        query(text: string, values: readonly unknown[] = []): Promise<ScriptedResult> {
          const normalised = text.replace(/\s+/g, ' ').trim();
          issued.push({ text: normalised, values });
          client.statements.push(normalised);
          options.onStatement?.(normalised);

          if (options.raise !== undefined && options.raise.when(normalised)) {
            return Promise.reject(options.raise.error);
          }
          const answer = answers.find((candidate) => candidate.when(normalised));
          if (answer === undefined) {
            return Promise.resolve({ rows: [], rowCount: 0 });
          }
          const seen = cursors.get(answer) ?? 0;
          cursors.set(answer, seen + 1);
          const result = answer.results[Math.min(seen, answer.results.length - 1)] ?? { rows: [], rowCount: 0 };
          if (options.block !== undefined && options.block.when(normalised)) {
            return options.block.until.then(() => result);
          }
          return Promise.resolve(result);
        },
        release(): void {
          // Nothing: the client is a plain object with no socket.
        },
      };
      // Structural: `DatabaseConnectionSource.connect()` is typed as `PoolClient`,
      // and `pg.Pool` satisfies it in production. A test double cast once, here,
      // is the single place that cast exists — §2.2's ban is on fakes in
      // *application* code, and this file is a spec.
      return Promise.resolve(client as unknown as PoolClient);
    },
  };

  return {
    source,
    connects: () => connects,
    statements: () => issued,
  };
}

/** A resolver plus the promise it settles: the only way to hold a sweep open. */
export function gate(): { readonly open: Promise<void>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return { open, release };
}
